import mongoose from 'mongoose';

const fileSchema = new mongoose.Schema({
  name: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  folderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Folder' },
  type: { type: String, enum: ['pdf', 'document', 'image', 'video', 'other'] },
  size: String, // e.g., "2.5 MB"
  sizeBytes: Number,
  mimeType: String,
  fileUrl: String, // CloudStorage or S3 URL
  dataUrl: String, // Base64 (only for small files)
  uploadedBy: String,
  isFavorite: { type: Boolean, default: false },
  isPrivate: { type: Boolean, default: false },
  pin: String, // 4-digit PIN for private files
  version: { type: Number, default: 1 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

export default mongoose.model('File', fileSchema);