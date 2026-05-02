import express from 'express';
import File from '../models/File.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

router.use(authMiddleware);

// Get user files
router.get('/', async (req, res) => {
  try {
    const files = await File.find({ userId: req.userId });
    res.json(files);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload file
router.post('/upload', async (req, res) => {
  try {
    const { name, folderId, dataUrl, type } = req.body;
    
    const file = new File({
      name,
      userId: req.userId,
      folderId,
      type,
      dataUrl,
      uploadedBy: req.headers['x-user-name'] || 'User'
    });
    
    await file.save();
    res.json(file);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete file
router.delete('/:id', async (req, res) => {
  try {
    const file = await File.findOneAndDelete({
      _id: req.params.id,
      userId: req.userId
    });
    if (!file) return res.status(404).json({ error: 'File not found' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;