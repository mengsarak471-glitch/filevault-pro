import express from 'express';
import Folder from '../models/Folder.js';
import { authMiddleware } from '../middleware/auth.js';

const router = express.Router();

router.use(authMiddleware);

// Get user folders
router.get('/', async (req, res) => {
  try {
    const folders = await Folder.find({ userId: req.userId });
    res.json(folders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create folder
router.post('/', async (req, res) => {
  try {
    const { name, parentId, color } = req.body;
    
    const folder = new Folder({
      name,
      userId: req.userId,
      parentId,
      color
    });
    
    await folder.save();
    res.json(folder);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete folder
router.delete('/:id', async (req, res) => {
  try {
    const folder = await Folder.findOneAndDelete({
      _id: req.params.id,
      userId: req.userId
    });
    if (!folder) return res.status(404).json({ error: 'Folder not found' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;