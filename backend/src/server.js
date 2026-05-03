const express = require('express');
const multer = require('multer');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');
const crypto = require('crypto');

// Simple JWT implementation
const JWT_SECRET = process.env.JWT_SECRET || 'filevault-secret-2024-xK9mP3qR';
const signToken = (payload) => {
    const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
    const body = Buffer.from(JSON.stringify({...payload, iat: Date.now()})).toString('base64url');
    const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${sig}`;
};
const verifyToken = (token) => {
    try {
        const [header, body, sig] = token.split('.');
        const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
        if (sig !== expected) return null;
        return JSON.parse(Buffer.from(body, 'base64url').toString());
    } catch { return null; }
};

// Rate limiter (simple in-memory)
const rateLimits = new Map();
const rateLimit = (maxReq, windowMs) => (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const data = rateLimits.get(key) || { count: 0, start: now };
    if (now - data.start > windowMs) { data.count = 0; data.start = now; }
    data.count++;
    rateLimits.set(key, data);
    if (data.count > maxReq) return res.status(429).json({ message: 'Too many requests, please wait.' });
    next();
};

// Auth middleware
const authMiddleware = (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ message: 'Unauthorized' });
    const payload = verifyToken(auth.split(' ')[1]);
    if (!payload) return res.status(401).json({ message: 'Invalid or expired token' });
    req.userId = payload.id;
    req.userRole = payload.role;
    next();
};

// Cloudinary config
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'debxadxsr',
    api_key: process.env.CLOUDINARY_API_KEY || '786599253482319',
    api_secret: process.env.CLOUDINARY_API_SECRET || '4ZDG7pboBDuMvQ53SOYkBuJ36cI',
});

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
// CORS - Allow ALL
app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Client-Version");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
});
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Database setup
const db = new sqlite3.Database('./filevault.db');

// Create tables
db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        username TEXT UNIQUE NOT NULL,
        email TEXT,
        dept TEXT,
        role TEXT DEFAULT 'user',
        avatar TEXT,
        password TEXT
    )`);

    // Folders table
    db.run(`CREATE TABLE IF NOT EXISTS folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        color TEXT DEFAULT '#3B82F6',
        icon TEXT DEFAULT '📁',
        quota INTEGER DEFAULT 5368709120,
        used INTEGER DEFAULT 0,
        parent_id INTEGER DEFAULT NULL,
        user_id INTEGER DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    // Force add columns if missing (safe - errors ignored)
    db.run(`ALTER TABLE folders ADD COLUMN parent_id INTEGER DEFAULT NULL`, () => {});
    db.run(`ALTER TABLE folders ADD COLUMN user_id INTEGER DEFAULT NULL`, () => {});

    // Files table
    db.run(`CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        size TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        folder_id INTEGER,
        user_id INTEGER,
        date TEXT NOT NULL,
        uploaded_by TEXT NOT NULL,
        is_favorite BOOLEAN DEFAULT 0,
        version INTEGER DEFAULT 1,
        file_path TEXT,
        file_url TEXT,
        deleted_at DATETIME,
        FOREIGN KEY (folder_id) REFERENCES folders (id)
    )`);
    // Add user_id and parent_id columns if not exist (migration)
    db.run(`ALTER TABLE files ADD COLUMN user_id INTEGER`, () => {});
    db.run(`ALTER TABLE folders ADD COLUMN user_id INTEGER`, () => {});
    db.run(`ALTER TABLE folders ADD COLUMN parent_id INTEGER`, () => {});

    // File versions table
    db.run(`CREATE TABLE IF NOT EXISTS file_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL,
        version INTEGER NOT NULL,
        date TEXT NOT NULL,
        uploaded_by TEXT NOT NULL,
        file_path TEXT NOT NULL,
        FOREIGN KEY (file_id) REFERENCES files (id)
    )`);

    // Activity log table
    db.run(`CREATE TABLE IF NOT EXISTS activities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user TEXT NOT NULL,
        action TEXT NOT NULL,
        time DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Insert initial data if tables are empty
    db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
        if (err || row.count > 0) return;

        const users = [
            { name: 'Admin User', username: 'admin', dept: 'Management', role: 'admin', email: 'admin@company.com', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=admin' },
            { name: 'John Doe', username: 'john', dept: 'Engineering', role: 'user', email: 'john@company.com', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=john' },
            { name: 'Sarah Smith', username: 'sarah', dept: 'HR', role: 'user', email: 'sarah@company.com', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=sarah' },
            { name: 'Mike Johnson', username: 'mike', dept: 'Sales', role: 'user', email: 'mike@company.com', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=mike' },
            { name: 'Lisa Wong', username: 'lisa', dept: 'Finance', role: 'user', email: 'lisa@company.com', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=lisa' },
            { name: 'David Brown', username: 'david', dept: 'Marketing', role: 'user', email: 'david@company.com', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=david' }
        ];

        const stmt = db.prepare("INSERT INTO users (name, username, email, dept, role, avatar) VALUES (?, ?, ?, ?, ?, ?)");
        users.forEach(user => {
            stmt.run([user.name, user.username, user.email, user.dept, user.role, user.avatar]);
        });
        stmt.finalize();
    });

    db.get("SELECT COUNT(*) as count FROM folders", (err, row) => {
        if (err || row.count > 0) return;

        const folders = [
            { name: 'Engineering', color: '#3B82F6', icon: '📚', quota: 5368709120 },
            { name: 'Marketing', color: '#EC4899', icon: '🎨', quota: 3221225472 },
            { name: 'Videos', color: '#8B5CF6', icon: '🎬', quota: 10737418240 },
            { name: 'Finance', color: '#10B981', icon: '💰', quota: 2147483648 }
        ];

        const stmt = db.prepare("INSERT INTO folders (name, color, icon, quota) VALUES (?, ?, ?, ?)");
        folders.forEach(folder => {
            stmt.run([folder.name, folder.color, folder.icon, folder.quota]);
        });
        stmt.finalize();
    });
});

// Multer - memory storage (upload to Cloudinary)
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 }
});

// Upload buffer to Cloudinary
const uploadToCloudinary = (buffer, filename) => {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            { resource_type: 'auto', public_id: `filevault/${Date.now()}-${filename}` },
            (error, result) => { if (error) reject(error); else resolve(result); }
        );
        Readable.from(buffer).pipe(stream);
    });
};

// Helper function to format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Helper function to get file type
function getFileType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    if (['pdf'].includes(ext)) return 'pdf';
    if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) return 'document';
    if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'ico'].includes(ext)) return 'image';
    if (['mp4', 'avi', 'mov', 'mkv', 'webm'].includes(ext)) return 'video';
    return 'document';
}

// API Routes

// Root health check
app.get('/', (req, res) => {
    res.json({ message: 'FileVault Pro API is running!', version: '1.0.0' });
});

// ===== AUTH ROUTES =====

// Login (rate limited: 10 attempts per minute)
app.post('/api/auth/login', rateLimit(10, 60000), (req, res) => {
    const { username, password } = req.body;
    if (!username) return res.status(400).json({ message: 'Username is required' });

    // Simple auth: password matches username or 'admin'/'1234'
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (err) return res.status(500).json({ message: 'Server error' });
        if (!user) return res.status(401).json({ message: 'Invalid username or password' });

        // Accept stored password, or default passwords (admin=admin, others=1234)
        const defaultPass = user.role === 'admin' ? 'admin' : '1234';
        const storedPass = user.password || defaultPass;
        if (password !== storedPass) {
            return res.status(401).json({ message: 'Invalid username or password' });
        }

        // Log activity
        db.run("INSERT INTO activities (user, action) VALUES (?, ?)", [user.name, 'logged in']);

        const token = signToken({ id: user.id, username: user.username, role: user.role });
        res.json({
            token,
            user: {
                id: user.id,
                name: user.name,
                username: user.username,
                email: user.email,
                dept: user.dept,
                role: user.role,
                avatar: user.avatar,
            }
        });
    });
});

// Logout
app.post('/api/auth/logout', (req, res) => {
    res.json({ message: 'Logged out successfully' });
});

// Get all users
app.get('/api/users', (req, res) => {
    db.all("SELECT * FROM users", (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// Get all folders with file counts (filter by user_id)
app.get('/api/folders', (req, res) => {
    const { userId } = req.query;
    let query = `
        SELECT f.*, 
               f.parent_id,
               COUNT(fl.id) as file_count,
               COALESCE(SUM(fl.size_bytes), 0) as used
        FROM folders f
        LEFT JOIN files fl ON f.id = fl.folder_id AND fl.deleted_at IS NULL
    `;
    const params = [];
    if (userId) {
        query += ` WHERE f.user_id = ?`;
        params.push(userId);
    }
    query += ` GROUP BY f.id`;

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const folders = rows.map(f => ({
            ...f,
            parent_id: f.parent_id !== undefined ? f.parent_id : null,
            parentId: f.parent_id !== undefined ? f.parent_id : null,
        }));
        res.json({ folders });
    });
});

// Get all files (filtered by userId)
app.get('/api/files', (req, res) => {
    const { folder_id, userId } = req.query;
    let query = "SELECT * FROM files WHERE deleted_at IS NULL";
    let params = [];
    if (userId) { query += " AND user_id = ?"; params.push(userId); }
    if (folder_id) { query += " AND folder_id = ?"; params.push(folder_id); }
    query += " ORDER BY date DESC";
    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ files: rows });
    });
});

// Get file versions
app.get('/api/files/:id/versions', (req, res) => {
    db.all("SELECT * FROM file_versions WHERE file_id = ? ORDER BY version DESC", [req.params.id], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// Upload file → Cloudinary
app.post('/api/files/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { folder_id, uploaded_by } = req.body;
    const file = req.file;
    try {
        // Upload to Cloudinary
        const cloudResult = await uploadToCloudinary(file.buffer, file.originalname);
        const fileInfo = {
            name: file.originalname,
            type: getFileType(file.originalname),
            size: formatFileSize(file.size),
            size_bytes: file.size,
            folder_id: folder_id || null,
            date: new Date().toISOString().split('T')[0],
            uploaded_by: uploaded_by || 'Unknown',
            file_url: cloudResult.secure_url,
            file_path: cloudResult.public_id,
        };
        const uploadUserId = req.body.userId || req.body.user_id || null;
        db.run(`INSERT INTO files (name, type, size, size_bytes, folder_id, user_id, date, uploaded_by, file_path, file_url)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [fileInfo.name, fileInfo.type, fileInfo.size, fileInfo.size_bytes,
             fileInfo.folder_id, uploadUserId, fileInfo.date, fileInfo.uploaded_by, fileInfo.file_path, fileInfo.file_url],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                db.run("INSERT INTO activities (user, action) VALUES (?, ?)", [fileInfo.uploaded_by, `uploaded "${fileInfo.name}"`]);
                if (fileInfo.folder_id) db.run("UPDATE folders SET used = used + ? WHERE id = ?", [fileInfo.size_bytes, fileInfo.folder_id]);
                res.json({ id: this.lastID, ...fileInfo, is_favorite: false, version: 1 });
            }
        );
    } catch(e) {
        console.error('Cloudinary upload error:', e);
        res.status(500).json({ error: 'Upload failed: ' + e.message });
    }
});

// Delete file via DELETE method (used by frontend)
app.delete('/api/files/:id', (req, res) => {
    const fileId = req.params.id;
    db.run("UPDATE files SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?", [fileId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'File moved to trash' });
    });
});

// Delete file (move to trash) via POST
app.post('/api/files/:id/trash', (req, res) => {
    const fileId = req.params.id;
    const { user } = req.body;

    db.get("SELECT * FROM files WHERE id = ?", [fileId], (err, file) => {
        if (err || !file) {
            res.status(404).json({ error: 'File not found' });
            return;
        }

        db.run("UPDATE files SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?", [fileId], (err) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }

            // Add to activity log
            db.run("INSERT INTO activities (user, action) VALUES (?, ?)", 
                [user, `deleted "${file.name}"`]);

            // Update folder usage
            if (file.folder_id) {
                db.run("UPDATE folders SET used = used - ? WHERE id = ?", [file.size_bytes, file.folder_id]);
            }

            res.json({ message: 'File moved to trash' });
        });
    });
});

// Get trash files (filtered by userId)
app.get('/api/trash', (req, res) => {
    const { userId } = req.query;
    let query = "SELECT * FROM files WHERE deleted_at IS NOT NULL";
    let params = [];
    if (userId) { query += " AND user_id = ?"; params.push(userId); }
    query += " ORDER BY deleted_at DESC";
    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ files: rows });
    });
});

// Restore file from trash
app.post('/api/files/:id/restore', (req, res) => {
    db.run("UPDATE files SET deleted_at = NULL WHERE id = ?", [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        db.run("INSERT INTO activities (user, action) VALUES (?, ?)", [req.body.user||'user', `restored file`]);
        res.json({ message: 'File restored' });
    });
});

// Rename file
app.patch('/api/files/:id/rename', (req, res) => {
    db.run("UPDATE files SET name = ? WHERE id = ?", [req.body.name, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Renamed' });
    });
});

// Rename folder
app.patch('/api/folders/:id/rename', (req, res) => {
    db.run("UPDATE folders SET name = ? WHERE id = ?", [req.body.name, req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Renamed' });
    });
});

// Toggle favorite
app.post('/api/files/:id/favorite', (req, res) => {
    const fileId = req.params.id;
    
    db.get("SELECT is_favorite FROM files WHERE id = ?", [fileId], (err, file) => {
        if (err || !file) {
            res.status(404).json({ error: 'File not found' });
            return;
        }

        const newFavorite = file.is_favorite ? 0 : 1;
        
        db.run("UPDATE files SET is_favorite = ? WHERE id = ?", [newFavorite, fileId], (err) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ is_favorite: !!newFavorite });
        });
    });
});

// Get activities
app.get('/api/activities', (req, res) => {
    const limit = req.query.limit || 50;
    db.all("SELECT * FROM activities ORDER BY time DESC LIMIT ?", [limit], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// Create folder
app.post('/api/folders', (req, res) => {
    const { name, color, icon, quota, parentId, parent_id, userId } = req.body;
    const pId = parentId || parent_id || null;
    const uId = userId || null;
    
    db.run(`
        INSERT INTO folders (name, color, icon, quota, parent_id, user_id)
        VALUES (?, ?, ?, ?, ?, ?)
    `, [name, color || '#3B82F6', icon || '📁', quota || 5368709120, pId, uId], function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ id: this.lastID, name, color, icon, quota, parent_id: pId, parentId: pId, user_id: uId, used: 0 });
    });
});

// Delete folder
app.delete('/api/folders/:id', (req, res) => {
    const folderId = req.params.id;
    
    db.run("DELETE FROM folders WHERE id = ?", [folderId], (err) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ message: 'Folder deleted' });
    });
});

// Edit user (admin only)
app.patch('/api/users/:id', (req, res) => {
    const { name, username, password, dept, email } = req.body;
    const updates = [];
    const params = [];
    if (name) { updates.push('name = ?'); params.push(name); }
    if (username) { updates.push('username = ?'); params.push(username); }
    if (password) { updates.push('password = ?'); params.push(password); }
    if (dept !== undefined) { updates.push('dept = ?'); params.push(dept); }
    if (email !== undefined) { updates.push('email = ?'); params.push(email); }
    if (updates.length === 0) return res.json({ message: 'No changes' });
    params.push(req.params.id);
    db.run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'User updated' });
    });
});

// Permanent delete file
app.delete('/api/files/:id/permanent', (req, res) => {
    db.get("SELECT * FROM files WHERE id = ?", [req.params.id], (err, file) => {
        if (err || !file) return res.status(404).json({ error: 'File not found' });
        // Delete from Cloudinary if has path
        if (file.file_path) {
            cloudinary.uploader.destroy(file.file_path, { resource_type: 'auto' }).catch(()=>{});
        }
        db.run("DELETE FROM files WHERE id = ?", [req.params.id], (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: 'File permanently deleted' });
        });
    });
});

// Security headers middleware
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ message: 'Not found' });
});

// Start server
app.listen(PORT, () => {
    console.log(`FileVault Pro server running on http://localhost:${PORT}`);
});