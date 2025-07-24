  import mongoose from "mongoose";

  const reportSchema = new mongoose.Schema({
    title: {
      type: String,
      required: true,
      trim: true
    },
    image: {
      type: String,
      required: true
    },
     publicId: {
    type: String,
    required: true // Make this required
  },
    details: {
      type: String,
      required: true,
      trim: true
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        required: true
      },
      coordinates: {
        type: [Number],
        required: true
      }
    },
    address: {
      type: String,
      required: true,
      trim: true
    },
    createdTime: {
      type: Date,
      default: Date.now
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    photoTimestamp: {
      type: Date,
      required: true
    },
    reportType: {
      type: String,
      enum: ['standard', 'hazardous', 'large'],
      default: 'standard'
    },
status: {
  type: String,
  enum: ['pending', 'in-progress', 'resolved', 'rejected', 'permanent-resolved', 'out-of-scope'],
  default: 'pending'
},
outOfScopeReason: String,
outOfScopeBy: {
  type: mongoose.Schema.Types.ObjectId,
  ref: "User"
},
outOfScopeAt: Date,
outOfScopeAt: Date,
resolvedImage: String,
  resolvedPublicId: String,
  resolvedLocation: {
    type: {
      type: String,
      enum: ['Point'],
    },
    coordinates: [Number],
  },
  resolvedAddress: String,
  resolvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },
   assignedTo: {
    type: mongoose.Schema.Types.ObjectId, 
    ref: "User"
  },
  assignedAt: Date,
  assignedMsg:String,
  distanceToReported: Number, 
permanentlyResolvedAt: Date,
permanentlyResolvedBy: {
  type: mongoose.Schema.Types.ObjectId,
  ref: "User"
},
  
   resolvedAt: Date,
   rejectionReason: String,
rejectedBy: {
  type: mongoose.Schema.Types.ObjectId,
  ref: "User"
},
rejectedAt: Date,
  }, {
    timestamps: true
  });

  // Create geospatial index
  reportSchema.index({ location: '2dsphere' });

  const Report = mongoose.model('Report', reportSchema);

  export default Report;