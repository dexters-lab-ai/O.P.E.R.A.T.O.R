// Connect to MongoDB Atlas via Mongoose
const mongoose = require('mongoose');
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

// Define User schema and model
const historySchema = new mongoose.Schema({
  command: String,
  result: mongoose.Schema.Types.Mixed,
  timestamp: Date
}, { _id: true });  // each history entry gets its own _id

const userSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  password: String,              // hashed password
  history: [ historySchema ]     // array of task history entries
});
const User = mongoose.model('User', userSchema);
