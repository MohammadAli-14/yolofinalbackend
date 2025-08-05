import express from 'express';
import Report from "../models/Report.js";
import User from "../models/User.js";
import cloudinary from '../lib/cloudinary.js';
import { isAuthenticated } from "../middleware/auth.js";
import classifyImage from '../services/classificationService.js';

const router = express.Router();

router.post('/', isAuthenticated, async (req, res) => {
  try {
    const {
      title,
      image,
      details,
      address,
      latitude,
      longitude,
      photoTimestamp,
      reportType,
      forceSubmit
    } = req.body;

    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    if (buffer.length > 5 * 1024 * 1024) {
      return res.status(413).json({ 
        message: 'Image too large (max 5MB)',
        code: 'IMAGE_TOO_LARGE'
      });
    }

    const missingFields = [];
    if (!title) missingFields.push('title');
    if (!image) missingFields.push('image');
    if (!details) missingFields.push('details');
    if (!address) missingFields.push('address');
    
    // Check if coordinates are provided
    if (latitude === undefined || longitude === undefined) {
      missingFields.push('location');
    }

    if (missingFields.length > 0) {
      return res.status(400).json({
        message: `Missing required fields: ${missingFields.join(', ')}`,
        code: 'MISSING_FIELDS',
        missingFields
      });
    }

    // Validate coordinate format and range
    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);
    
    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({
        message: 'Invalid coordinates',
        code: 'INVALID_COORDINATES'
      });
    }
    
    // Validate coordinate ranges
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return res.status(400).json({
        message: 'Coordinates out of valid range',
        code: 'INVALID_COORDINATES_RANGE',
        details: {
          validLatitudeRange: '[-90, 90]',
          validLongitudeRange: '[-180, 180]',
          received: { latitude: lat, longitude: lon }
        }
      });
    }

    if (!/^(data:image\/\w+;base64,)?[A-Za-z0-9+/=]+$/.test(image)) {
      return res.status(400).json({
        message: 'Invalid image format',
        code: 'INVALID_IMAGE_FORMAT'
      });
    }

    let classification;
    if (!forceSubmit) {
      try {
        classification = await classifyImage(image);

        if (!classification.isWaste) {
          return res.status(400).json({
            message: 'Image does not show recognizable waste',
            classification,
            code: 'NOT_WASTE'
          });
        }
        
        if (classification.confidence < 0.7) {
          return res.status(400).json({
            message: 'Low confidence in waste detection',
            classification,
            code: 'LOW_CONFIDENCE'
          });
        }
      } catch (error) {
        return res.status(503).json({
          message: 'Waste verification service unavailable',
          code: 'SERVICE_UNAVAILABLE',
          error: error.message
        });
      }
    }

    let uploadResponse;
    try {
      const cloudinaryPromise = cloudinary.uploader.upload(
        `data:image/jpeg;base64,${image}`,
        {
          resource_type: 'image',
          folder: 'reports',
          quality: 'auto',
          format: 'jpg',
          transformation: [{ width: 800, crop: 'limit' }, { quality: 'auto:good' }]
        }
      );
      const uploadTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('CLOUDINARY_TIMEOUT')), 15000)
      );
      uploadResponse = await Promise.race([cloudinaryPromise, uploadTimeout]);
    } catch (uploadError) {
      if (uploadError.message === 'CLOUDINARY_TIMEOUT') {
        return res.status(504).json({
          message: 'Image upload timed out',
          code: 'CLOUDINARY_TIMEOUT'
        });
      }
      return res.status(500).json({
        message: 'Image upload failed',
        error: uploadError.message,
        code: 'CLOUDINARY_ERROR'
      });
    }

    const finalReportType = reportType || 'standard';
    const newReport = new Report({
      title: title.trim(),
      image: uploadResponse.secure_url,
      publicId: uploadResponse.public_id,
      details: details.trim(),
      address: address.trim(),
      reportType: finalReportType,
      location: {
        type: 'Point',
        coordinates: [lon, lat]  // Use validated coordinates
      },
      photoTimestamp: photoTimestamp ? new Date(photoTimestamp) : new Date(),
      user: req.user._id,
      aiVerification: classification ? {
        isWaste: classification.isWaste,
        confidence: classification.confidence,
        verification: classification.verification
      } : null
    });
    const savedReport = await newReport.save();

    const pointsMap = { standard: 10, hazardous: 20, large: 15 };
    const pointsToAdd = pointsMap[finalReportType] || 10;
    try {
      await User.findByIdAndUpdate(req.user._id, {
        $inc: { reportCount: 1, points: pointsToAdd }
      });
    } catch (updateError) {
      // Silent fail for user points update
    }

    res.status(201).json({
      message: 'Report created successfully',
      report: savedReport,
      pointsEarned: pointsToAdd,
      classification
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        message: 'Validation Error',
        error: error.message,
        code: 'VALIDATION_ERROR'
      });
    }
    res.status(500).json({
      message: 'Internal server error',
      error: error.message,
      code: 'INTERNAL_SERVER_ERROR'
    });
  }
});

// Test classification route
// POST endpoint for test classification
router.post('/test-classify', isAuthenticated, async (req, res) => {
  try {
    const { image } = req.body;
    
    if (!image) {
      return res.status(400).json({ 
        error: 'No image provided',
        code: 'MISSING_IMAGE'
      });
    }

    console.log('Testing classification with image');
    const result = await classifyImage(image);
    console.log('Classification result:', result);
    
    res.json(result);
  } catch (error) {
    console.error('Test classification error:', error);
    res.status(500).json({ 
      error: 'Classification failed',
      details: error.message,
      stack: error.stack // Only for development!
    });
  }
});

// Pagination => infinite loading
router.get("/", isAuthenticated, async (req, res) => {
  try {
    const page = req.query.page || 1;
    const limit = req.query.limit || 10;
    const skip = (page - 1) * limit;
    const reports = await Report.find().sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("user", "username profileImage");

    const totalReports = await Report.countDocuments();

    res.send({  
      reports,
      currentPage: page,
      totalReports,
      totalPages: Math.ceil(totalReports / limit),
    });
  } catch (error) {
    console.log("Error in getting reports:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

// Get reports that are being reported by the logged in user 
router.get("/user", isAuthenticated, async (req, res) => {
  try {
    const reports = await Report.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .populate("user", "username profileImage");
    res.json(reports);
  } catch (error) {
    console.log("Error in getting user reports:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

router.delete("/:id", isAuthenticated, async (req, res) => {
  try {
    const report = await Report.findById(req.params.id);
    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    if (report.user.toString() !== req.user._id.toString()) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (report.publicId) {
      try {
        await cloudinary.uploader.destroy(report.publicId);
      } catch (deleteError) {
        console.error("Cloudinary deletion error:", deleteError);
      }
    }

    const pointsMap = {
      standard: 10,
      hazardous: 20,
      large: 15
    };
    
    const pointsToDeduct = report.reportType 
      ? pointsMap[report.reportType] || 10 
      : 10;

    await User.findByIdAndUpdate(req.user._id, {
      $inc: { 
        reportCount: -1, 
        points: -pointsToDeduct 
      }
    });

    await report.deleteOne();
    res.json({ message: "Report deleted successfully" });
    
  } catch (error) {
    console.error("Delete Report Error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});
router.get("/:id", isAuthenticated, async (req, res) => {
  try {
    const report = await Report.findById(req.params.id)
      .populate('user', 'username profileImage')
      .populate('assignedTo', 'username email profileImage')
      .populate('assignedBy', 'username profileImage')
      .populate('resolvedBy', 'username email profileImage')
      .populate('permanentlyResolvedBy', 'username email profileImage')
      .populate('rejectedBy', 'username email profileImage')
      .populate('outOfScopeBy', 'username email profileImage');

    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    // Verify report ownership
    if (report.user._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Unauthorized access" });
    }

    res.json(report);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

export default router;