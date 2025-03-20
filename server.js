// server.js
require('dotenv').config();
const express = require('express');
const app = express();
const bcrypt = require('bcrypt');
const { ObjectId } = require('mongodb');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const puppeteer = require('puppeteer');
const { PuppeteerAgent } = require('@midscene/web/puppeteer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid'); // For unique file names
const OpenAI = require('openai');

// Use Nut.js instead of robotjs for desktop automation:
const { keyboard, Key } = require('@nut-tree-fork/nut-js');

// Initialize the OpenAI client using new SDK syntax.
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Create midscene_run directory if it doesn't exist
const MIDSCENE_RUN_DIR = path.join(__dirname, 'midscene_run');
if (!fs.existsSync(MIDSCENE_RUN_DIR)) {
  fs.mkdirSync(MIDSCENE_RUN_DIR, { recursive: true });
}

// Define a fixed folder for reports:
const REPORT_DIR = path.join(MIDSCENE_RUN_DIR, 'report');
if (!fs.existsSync(REPORT_DIR)) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
}

// Serve midscene_run directory statically
app.use('/midscene_run', express.static(MIDSCENE_RUN_DIR));
app.use('/midscene_run/report', express.static(path.join(__dirname, 'midscene', 'report')));

// --- Mongoose Connection & Schema ---
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://dailAdmin:ua5^bRNFCkU*--c@operator.smeax.mongodb.net/?retryWrites=true&w=majority&appName=OPERATOR";
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("Connected to MongoDB via Mongoose"))
  .catch(err => console.error("Mongoose connection error:", err));

// --- Express Middleware ---
app.use(express.json());
app.use(express.static('public'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    client: mongoose.connection.getClient(),
    dbName: 'dail',
    collectionName: 'sessions'
  })
}));

// --- Authentication Middleware ---
function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ success: false, error: 'Not logged in' });
  }
  next();
}

// Enhanced User Schema with subtasks and custom URLs
const userSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  password: String,
  customUrls: [{ type: String }],
  history: [{
    _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
    url: String,
    command: String,
    result: mongoose.Schema.Types.Mixed, // { raw, aiPrepared, runReport }
    timestamp: { type: Date, default: Date.now }
  }],
  activeTasks: [{
    _id: { type: mongoose.Schema.Types.ObjectId, default: () => new mongoose.Types.ObjectId() },
    url: String,
    command: String,
    status: { type: String, enum: ['pending', 'processing', 'completed', 'error'], default: 'pending' },
    progress: { type: Number, default: 0 },
    startTime: { type: Date, default: Date.now },
    endTime: Date,
    error: String,
    isComplex: { type: Boolean, default: false },
    subTasks: [{
      id: { type: String },
      command: String,
      status: { type: String, enum: ['pending', 'processing', 'completed', 'error'], default: 'pending' },
      result: mongoose.Schema.Types.Mixed,
      progress: { type: Number, default: 0 },
      error: String
    }],
    intermediateResults: [mongoose.Schema.Types.Mixed]
  }]
});
const User = mongoose.model('User', userSchema);

// --- Routes ---

// Registration
app.post('/register', async (req, res) => {
  const { email, password } = req.body;
  try {
    const existing = await User.findOne({ email });
    if (existing) throw new Error('Email already exists');
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({ email, password: hashedPassword, history: [], activeTasks: [], customUrls: [] });
    req.session.user = newUser._id;
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      throw new Error('Invalid email or password');
    }
    req.session.user = user._id;
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login.html');
  });
});

// Get user history
app.get('/history', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.user);
    res.json(user.history);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/history/:id', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.user);
    const historyItem = user.history.find(h => h._id.toString() === req.params.id);
    if (!historyItem) return res.status(404).json({ success: false, error: 'History item not found' });
    res.json(historyItem);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete a history entry
app.delete('/history/:id', requireAuth, async (req, res) => {
  try {
    await User.updateOne(
      { _id: req.session.user },
      { $pull: { history: { _id: req.params.id } } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Clear all history
app.delete('/history', requireAuth, async (req, res) => {
  try {
    await User.updateOne(
      { _id: req.session.user },
      { $set: { history: [] } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update task progress
app.put('/tasks/:id/progress', requireAuth, async (req, res) => {
  const { progress } = req.body;
  try {
    await User.updateOne(
      { _id: req.session.user, 'activeTasks._id': req.params.id },
      { $set: { 'activeTasks.$.progress': progress } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/tasks/active', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.user);
    const activeTasks = user.activeTasks.filter(task => task.status === 'pending' || task.status === 'processing' || task.status === 'canceled');
    res.json(activeTasks);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/tasks/:id/stream', requireAuth, async (req, res) => {
  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    const sendUpdate = async () => {
      const user = await User.findById(req.session.user);
      const task = user.activeTasks.find(t => t._id.toString() === req.params.id);
      if (!task) {
        const historyItem = user.history.find(h => h._id.toString() === req.params.id);
        if (historyItem) {
          res.write(`data: ${JSON.stringify({ status: 'completed', result: historyItem.result, done: true })}\n\n`);
        } else {
          res.write(`data: ${JSON.stringify({ done: true, error: 'Task not found' })}\n\n`);
        }
        clearInterval(interval);
        res.end();
        return;
      }
      res.write(`data: ${JSON.stringify({ status: task.status, progress: task.progress, subTasks: task.subTasks, intermediateResults: task.intermediateResults, error: task.error, result: task.result })}\n\n`);
      if (task.isDone) {
        res.write(`data: ${JSON.stringify({ status: task.status, result: task.result, error: task.error, done: true })}\n\n`);
        clearInterval(interval);
        res.end();
      }
    };
    await sendUpdate();
    const interval = setInterval(sendUpdate, 1000);
    req.on('close', () => {
      clearInterval(interval);
      res.end();
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get and set custom URLs
app.get('/custom-urls', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.user);
    res.json(user.customUrls);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/custom-urls', requireAuth, async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ success: false, error: 'URL is required' });
  }
  try {
    await User.updateOne(
      { _id: req.session.user },
      { $addToSet: { customUrls: url } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/custom-urls/:url', requireAuth, async (req, res) => {
  const { url } = req.params;
  try {
    await User.updateOne(
      { _id: req.session.user },
      { $pull: { customUrls: url } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Utility Functions ---
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function updateTaskStatus(userId, taskId, status, progress, error = null) {
  const updates = { 'activeTasks.$.status': status, 'activeTasks.$.progress': progress };
  if (status === 'completed' || status === 'error') updates['activeTasks.$.endTime'] = new Date();
  if (error) updates['activeTasks.$.error'] = error;
  await User.updateOne({ _id: userId, 'activeTasks._id': taskId }, { $set: updates });
}

async function addIntermediateResult(userId, taskId, result) {
  await User.updateOne({ _id: userId, 'activeTasks._id': taskId }, { $push: { 'activeTasks.$.intermediateResults': result } });
}

async function updateSubTask(userId, taskId, subTaskId, updates) {
  const user = await User.findById(userId);
  const task = user.activeTasks.find(t => t._id.toString() === taskId.toString());
  if (!task) return;
  const subTaskIndex = task.subTasks.findIndex(st => st.id === subTaskId);
  if (subTaskIndex === -1) return;
  Object.keys(updates).forEach(key => { task.subTasks[subTaskIndex][key] = updates[key]; });
  await user.save();
}

function isComplexTask(command) {
  return (command.length > 150 ||
    command.split('.').length > 3 ||
    command.includes(' and ') ||
    command.includes(' then ') ||
    command.includes('after that') ||
    command.includes('finally'));
}

function splitIntoSubTasks(command) {
  let subtasks = [];
  if (command.includes(' then ') || command.includes('. ') || command.includes(', ')) {
    const parts = command.split(/\s+then\s+|\.\s+|,\s+/).filter(Boolean);
    subtasks = parts.map((part, index) => ({
      id: `subtask-${index + 1}`,
      command: part.trim(),
      status: 'pending',
      progress: 0
    }));
  } else {
    subtasks = [
      { id: 'subtask-1', command: `Navigate to the site and prepare: ${command.substring(0, Math.min(50, command.length))}...`, status: 'pending', progress: 0 },
      { id: 'subtask-2', command: `Determine navigation steps and navigate the page appropriately to prepare for the command: ${command}`, status: 'pending', progress: 0 },
      { id: 'subtask-3', command: `Execute main task: ${command}`, status: 'pending', progress: 0 },
      { id: 'subtask-4', command: `If form submission is involved navigate the form inputs and enter values in command/instruction/task. Navigate tabs, sub menus, drop downs etc to achieve full task. If the task is research only scroll the page, determine navigation steps and execute them to move around and extract the information required to meet task in full, scroll full page usually. Verify completion and extract results`, status: 'pending', progress: 0 }
    ];
  }
  return subtasks;
}

// --- OpenAI Function Calling Integration ---
// Define function schemas
const functions = [
  {
    name: "navigate",
    description: "Navigate the browser to a specified URL.",
    parameters: {
      type: "object",
      properties: { url: { type: "string", description: "The URL to navigate to" } },
      required: ["url"]
    }
  },
  {
    name: "click_element",
    description: "Click an element on the page identified by a selector or text.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "CSS selector or text content to identify the element" } },
      required: ["query"]
    }
  },
  {
    name: "input_text",
    description: "Type text into an input field identified by a selector.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "CSS selector for the input field" },
        text: { type: "string", description: "Text to input" }
      },
      required: ["query", "text"]
    }
  },
  {
    name: "scroll_page",
    description: "Scroll the page in a specified direction by a specified amount.",
    parameters: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down"], description: "Direction to scroll" },
        amount: { type: "string", description: "Amount to scroll (e.g., '100px' or '50%')" }
      },
      required: ["direction", "amount"]
    }
  },
  {
    name: "open_application",
    description: "Launch a desktop application by name (via OS Start menu search).",
    parameters: {
      type: "object",
      properties: {
        appName: { type: "string", description: "The name of the application to open" }
      },
      required: ["appName"]
    }
  }
];

// Function to simulate ensuring an element is visible
async function ensureElementVisible(selector) {
  const element = await page.$(selector);
  if (!element) return false;
  const isVisible = await element.isIntersectingViewport();
  if (!isVisible) {
    await element.evaluate(el => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    await sleep(300);
  }
  return true;
}

// Desktop app launcher using Nut.js
async function openApplication(appName) {
  if (process.platform === 'win32') {
    await keyboard.pressKey(Key.LeftSuper);
    await sleep(500);
    await keyboard.type(appName);
    await sleep(500);
    await keyboard.pressKey(Key.Enter);
    await keyboard.releaseKey(Key.Enter);
    return `Launched application "${appName}" via Start menu.`;
  } else if (process.platform === 'darwin') {
    require('child_process').exec(`open -a "${appName}"`);
    return `Opened application "${appName}" on macOS.`;
  } else if (process.platform === 'linux') {
    require('child_process').exec(`${appName} &`);
    return `Attempted to launch "${appName}" on Linux.`;
  }
  return `Platform not supported for openApplication.`;
}

// Natural Language Interaction (NLI) using OpenAI function calling
async function runAutomation(userInstruction) {
  const messages = [
    { role: "system", content: "You are an AI automation agent controlling a web browser and desktop apps. Use the provided functions to execute tasks." },
    { role: "user", content: userInstruction }
  ];
  while (true) {
    // Updated OpenAI call syntax:
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: messages,
      functions: functions,
      function_call: "auto"
    });
    
    // Define 'reply' from the API response
    const reply = response.data.choices[0].message;
    if (reply.function_call) {
      const funcName = reply.function_call.name;
      const args = reply.function_call.arguments ? JSON.parse(reply.function_call.arguments) : {};
      let funcResult;
      try {
        switch (funcName) {
          case "navigate":
            await page.goto(args.url, { waitUntil: 'networkidle0' });
            funcResult = { result: `Navigated to ${args.url}` };
            break;
          case "click_element":
            await ensureElementVisible(args.query);
            await page.click(args.query);
            funcResult = { result: `Clicked element "${args.query}"` };
            break;
          case "input_text":
            await page.type(args.query, args.text, { delay: 50 });
            funcResult = { result: `Entered text into "${args.query}"` };
            break;
          case "scroll_page":
            const amount = args.amount;
            if (args.direction === "down") {
              await page.evaluate(y => window.scrollBy(0, y), parseInt(amount));
            } else {
              await page.evaluate(y => window.scrollBy(0, -y), parseInt(amount));
            }
            funcResult = { result: `Scrolled ${args.direction} by ${amount}` };
            break;
          case "open_application":
            funcResult = { result: await openApplication(args.appName) };
            break;
          default:
            funcResult = { error: `Unknown function: ${funcName}` };
        }
      } catch (error) {
        funcResult = { error: error.message };
      }
      messages.push({ role: "assistant", function_call: reply.function_call });
      messages.push({ role: "function", name: funcName, content: JSON.stringify(funcResult) });
      continue;
    } else {
      return reply.content;
    }
  }
}

// Cancel an active task by ID
app.post('/tasks/:id/cancel', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.user);
    // Find the index of the task in the activeTasks array
    const taskIndex = user.activeTasks.findIndex(t => t._id.toString() === req.params.id);
    if (taskIndex === -1) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    const task = user.activeTasks[taskIndex];

    // If it is a repetitive task, clear its interval
    if (task.isRepetitive && task.intervalId) {
      clearInterval(task.intervalId);
    }

    // For tasks using Puppeteer, if you have stored a browser instance reference,
    // you could close it here. (That would require extra logic to track running browsers.)

    // Remove the task from the active tasks array
    user.activeTasks.splice(taskIndex, 1);
    await user.save();

    res.json({ success: true, message: 'Task canceled successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- Main /automate Endpoint ---
app.post('/automate', requireAuth, async (req, res) => {
  const { url, command } = req.body;
  if (!url || !command) {
    return res.status(400).json({ success: false, error: 'URL and command are required.' });
  }

  const isComplex = isComplexTask(command);
  const subTasks = isComplex ? splitIntoSubTasks(command) : [];
  const user = await User.findById(req.session.user);
  const taskId = new mongoose.Types.ObjectId();
  user.activeTasks.push({
    _id: taskId,
    url,
    command,
    status: 'pending',
    progress: 0,
    startTime: new Date(),
    isComplex,
    subTasks,
    intermediateResults: []
  });
  await user.save();

  // Immediately respond so the client can update its UI
  res.json({ success: true, taskId, isComplex });

  let browser;
  try {
    console.log("[Midscene] Starting task for URL:", url, "with command:", command);
    await updateTaskStatus(req.session.user, taskId, 'processing', 10);

    // Launch browser
    browser = await puppeteer.launch({
      headless: false,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-accelerated-2d-canvas",
        "--disable-3d-apis",
        "--disable-notifications",
        "--window-size=1080,768"
      ],
      timeout: 120000
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 768, deviceScaleFactor: process.platform === "darwin" ? 2 : 1 });
    page.setDefaultTimeout(600000);
    page.setDefaultNavigationTimeout(300000);
    await updateTaskStatus(req.session.user, taskId, 'processing', 20);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 180000 });
    console.log("[Midscene] Navigated to URL:", url);
    await sleep(4000);
    await page.evaluate(() => new Promise(resolve => {
      if (document.readyState === 'complete') resolve();
      else window.addEventListener('load', resolve);
    }));
    await updateTaskStatus(req.session.user, taskId, 'processing', 30);
    const agent = new PuppeteerAgent(page, { forceSameTabNavigation: true, executionTimeout: 600000, planningTimeout: 300000 });
    console.log("[Midscene] Using configured OpenAI API key:", process.env.OPENAI_API_KEY ? "Yes" : "No");
    const runId = uuidv4();
    const runDir = path.join(MIDSCENE_RUN_DIR, runId);
    fs.mkdirSync(runDir, { recursive: true });

    if (isComplex) {
      console.log("[Midscene] Processing complex task with subtasks");
      let finalResults = [];
      let hasError = false;

      for (let i = 0; i < subTasks.length; i++) {
        const subtask = subTasks[i];
        console.log(`[Midscene] Starting subtask ${i + 1}/${subTasks.length}: ${subtask.command}`);
        try {
          await updateSubTask(req.session.user, taskId, subtask.id, { status: 'processing', progress: 10 });
          const overallProgress = Math.floor(30 + ((i / subTasks.length) * 60));
          await updateTaskStatus(req.session.user, taskId, 'processing', overallProgress);
          await sleep(2000);
          await page.evaluate(() => new Promise(resolve => {
            if (document.readyState === 'complete') resolve();
            else window.addEventListener('load', resolve);
          }));
          try {
            await agent.aiAction(subtask.command);
          } catch (actionError) {
            if (actionError.message.includes("Element not found")) {
              console.log("[Midscene] Element not found, trying alternate approach...");
              await agent.aiAction("Check if we need to navigate to a delegation section first, or look for alternative UI elements");
            } else {
              throw actionError;
            }
          }
          await sleep(2000);
          const subtaskScreenshot = await page.screenshot({ encoding: 'base64' });
          const subtaskPageText = await page.evaluate(() => document.body.innerText);
          const screenshotPath = path.join(runDir, `subtask-${i + 1}.png`);
          fs.writeFileSync(screenshotPath, Buffer.from(subtaskScreenshot, 'base64'));
          const subtaskResult = await agent.aiQuery(
            "Describe what you just accomplished in this step in a human-readable format. Format as JSON with fields: { step, success, summary, data }"
          );
          let parsedSubtaskResult;
          try {
            parsedSubtaskResult = typeof subtaskResult === 'string' ? JSON.parse(subtaskResult) : subtaskResult;
          } catch (parseError) {
            parsedSubtaskResult = { step: `Subtask ${i + 1}`, success: false, summary: "Failed to parse AI result", rawOutput: subtaskResult };
          }
          const subtaskFullResult = {
            raw: { screenshotPath: `/midscene_run/${runId}/subtask-${i + 1}.png`, pageText: subtaskPageText },
            aiPrepared: parsedSubtaskResult,
            runReport: `/midscene_run/${runId}/report.html` // Updated to match old implementation
          };
          await addIntermediateResult(req.session.user, taskId, subtaskFullResult);
          finalResults.push(subtaskFullResult);
          await updateSubTask(req.session.user, taskId, subtask.id, { status: 'completed', progress: 100, result: subtaskFullResult });
        } catch (subtaskError) {
          console.error(`[Midscene] Error in subtask ${i + 1}:`, subtaskError);
          hasError = true;
          await updateSubTask(req.session.user, taskId, subtask.id, { status: 'error', progress: 100, error: subtaskError.message });
          if (i < subTasks.length - 1) {
            const shouldContinue = await agent.aiQuery(
              `The previous step (${subtask.command}) failed with error: ${subtaskError.message}. Is it possible to continue with the remaining steps? Answer with just yes or no.`
            );
            if (shouldContinue.toLowerCase().includes('no')) {
              throw new Error(`Could not continue after subtask ${i + 1} failed: ${subtaskError.message}`);
            }
          }
        }
      }

      let finalSummary;
      try {
        finalSummary = await agent.aiQuery(
          "Create a comprehensive summary of the performed tasks. Return structured JSON with fields: { summary, subtasks }"
        );
      } catch (summaryError) {
        console.error("[Midscene] Error generating final summary:", summaryError);
        finalSummary = { summary: "Failed to generate summary due to an error", error: summaryError.message };
        hasError = true;
      }

      let parsedFinalSummary;
      try {
        parsedFinalSummary = typeof finalSummary === 'string' ? JSON.parse(finalSummary) : finalSummary;
      } catch (parseError) {
        parsedFinalSummary = { summary: "Failed to parse final summary", rawOutput: finalSummary };
        hasError = true;
      }

      // Ensure report path consistency
      const reportPath = path.join(runDir, 'report.html');
      if (!fs.existsSync(reportPath)) {
        fs.writeFileSync(reportPath, `<html><body><h1>Midscene Run Report</h1><p>Task ID: ${taskId}</p><p>Command: ${command}</p></body></html>`);
      }

      const finalResult = {
        raw: finalResults.map(subtask => subtask.raw),
        aiPrepared: { subtasks: finalResults.map(subtask => subtask.aiPrepared), summary: parsedFinalSummary },
        runReport: `/midscene_run/${runId}/report.html`
      };

      await User.updateOne(
        { _id: req.session.user },
        { $push: { history: { _id: taskId, url, command, result: finalResult, timestamp: new Date() } } }
      );
      await User.updateOne(
        { _id: req.session.user },
        { $pull: { activeTasks: { _id: taskId } } }
      );
      await updateTaskStatus(req.session.user, taskId, hasError ? 'error' : 'completed', 100, hasError ? "One or more subtasks failed" : null);
    } else {
      console.log("[Midscene] Executing simple task with command:", command);
      await updateTaskStatus(req.session.user, taskId, 'processing', 50);
      let hasError = false;
      let finalResult;

      try {
        await page.evaluate(() => new Promise(resolve => {
          if (document.readyState === 'complete') resolve();
          else window.addEventListener('load', resolve);
        }));
        const actionResult = await Promise.race([
          agent.aiAction(command),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Task execution timeout - splitting into subtasks")), 300000))
        ]);
        await sleep(2000);
        await updateTaskStatus(req.session.user, taskId, 'processing', 80);
        const screenshot = await page.screenshot({ encoding: 'base64' });
        const pageText = await page.evaluate(() => document.body.innerText);
        const screenshotPath = path.join(runDir, 'screenshot.png');
        fs.writeFileSync(screenshotPath, Buffer.from(screenshot, 'base64'));
        let result;
        try {
          result = await agent.aiQuery(
            "Summarize what you did and the result in a human-readable format. Format as JSON with fields: { success, summary, data }"
          );
        } catch (queryError) {
          console.error("[Midscene] Error in aiQuery:", queryError);
          result = await agent.aiQuery("Describe the actions and result in JSON format.");
          hasError = true;
        }
        let parsedResult;
        try {
          parsedResult = typeof result === 'string' ? JSON.parse(result) : result;
        } catch (parseError) {
          console.log("[Midscene] Failed to parse AI result as JSON, storing fallback");
          parsedResult = { success: false, summary: "Failed to parse AI result", rawOutput: result };
          hasError = true;
        }
        const reportPath = path.join(runDir, 'report.html');
        if (!fs.existsSync(reportPath)) {
          fs.writeFileSync(reportPath, `<html><body><h1>Midscene Run Report</h1><p>Task ID: ${taskId}</p><p>Command: ${command}</p></body></html>`);
        }
        finalResult = {
          raw: { screenshotPath: `/midscene_run/${runId}/screenshot.png`, pageText: pageText },
          aiPrepared: parsedResult,
          runReport: `/midscene_run/${runId}/report.html`
        };
      } catch (actionError) {
        console.error("[Midscene] Error in simple task execution:", actionError);
          console.log("[Midscene] Converting to complex task and retrying...");
          await User.updateOne(
            { _id: req.session.user, 'activeTasks._id': taskId },
            { $set: { 'activeTasks.$.isComplex': true, 'activeTasks.$.subTasks': splitIntoSubTasks(command) } }
          );
          await updateTaskStatus(req.session.user, taskId, 'processing', 40);
          if (browser) {
            await browser.close();
            browser = null;
          }
          const automateComplexTask = require('./automateComplexTask');
          await automateComplexTask(req.session.user, taskId, url, command);
          return; // Exit after delegating to automateComplexTask
      }

      await User.updateOne(
        { _id: req.session.user },
        { $push: { history: { _id: taskId, url, command, result: finalResult, timestamp: new Date() } } }
      );
      await User.updateOne(
        { _id: req.session.user },
        { $pull: { activeTasks: { _id: taskId } } }
      );
      await updateTaskStatus(req.session.user, taskId, hasError ? 'error' : 'completed', 100, hasError ? "Error in simple task execution" : null);
    }
  } catch (err) {
    console.error("[Midscene] Error in /automate:", err);
    await updateTaskStatus(req.session.user, taskId, 'error', 100, err.message || "Unknown error");
    await User.updateOne(
      { _id: req.session.user },
      { $pull: { activeTasks: { _id: taskId } } }
    );
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (closeErr) {
        console.error("[Midscene] Error closing browser:", closeErr);
      }
      browser = null;
    }
  }
});

module.exports = async function automateComplexTask(userId, taskId, url, command) {
  const User = mongoose.model('User');
  let browser;
  try {
    const user = await User.findById(userId);
    const task = user.activeTasks.find(t => t._id.toString() === taskId.toString());
    if (!task || !task.isComplex || !task.subTasks || task.subTasks.length === 0) {
      throw new Error("Task not found or not properly configured as complex");
    }

    console.log(`[ComplexTask] Starting complex task for user ${userId}, task ${taskId}`);

    browser = await puppeteer.launch({
      headless: false,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--window-size=1080,768"],
      timeout: 120000
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 768, deviceScaleFactor: process.platform === "darwin" ? 2 : 1 });
    page.setDefaultTimeout(300000);
    page.setDefaultNavigationTimeout(180000);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 180000 });
    await sleep(4000);
    await page.evaluate(() => new Promise(resolve => {
      if (document.readyState === 'complete') resolve();
      else window.addEventListener('load', resolve);
    }));
    const agent = new PuppeteerAgent(page, { forceSameTabNavigation: true, executionTimeout: 600000, planningTimeout: 300000 });
    const runId = uuidv4();
    const runDir = path.join(MIDSCENE_RUN_DIR, runId);
    fs.mkdirSync(runDir, { recursive: true });
    let finalResults = [];
    let hasError = false;

    for (let i = 0; i < task.subTasks.length; i++) {
      const subtask = task.subTasks[i];
      console.log(`[ComplexTask] Processing subtask ${i + 1}/${task.subTasks.length}: ${subtask.command}`);
      try {
        subtask.status = 'processing';
        subtask.progress = 10;
        const overallProgress = Math.floor(30 + ((i / task.subTasks.length) * 60));
        task.progress = overallProgress;
        await user.save();
        await page.waitForTimeout(10000);
        await page.evaluate(() => new Promise(resolve => {
          if (document.readyState === 'complete') resolve();
          else window.addEventListener('load', resolve);
        }));
        try {
          await agent.aiAction(subtask.command);
        } catch (actionError) {
          if (actionError.message.includes("Element not found")) {
            console.log("[Midscene] Element not found, trying alternate approach...");
            await agent.aiAction("Check if we need to navigate to a delegation section first, or look for alternative UI elements");
          } else {
            throw actionError;
          }
        }
        await sleep(2000);
        const subtaskScreenshot = await page.screenshot({ encoding: 'base64' });
        const subtaskPageText = await page.evaluate(() => document.body.innerText);
        const screenshotPath = path.join(runDir, `subtask-${i + 1}.png`);
        fs.writeFileSync(screenshotPath, Buffer.from(subtaskScreenshot, 'base64'));
        const subtaskResult = await agent.aiQuery(
          "Describe what you just accomplished in this step in a human-readable format. Provide a summary and any relevant data extracted. Format as JSON with fields: {step, success, summary, data}"
        );
        let parsedResult;
        try {
          parsedResult = typeof subtaskResult === 'string' ? JSON.parse(subtaskResult) : subtaskResult;
        } catch (parseError) {
          parsedResult = { step: `Subtask ${i + 1}`, success: false, summary: "Failed to parse AI result", rawOutput: subtaskResult };
          hasError = true;
        }
        const subtaskFullResult = {
          raw: { screenshotPath: `/midscene_run/${runId}/subtask-${i + 1}.png`, pageText: subtaskPageText },
          aiPrepared: parsedResult,
          runReport: `/midscene_run/${runId}/report.html`
        };
        task.intermediateResults.push(subtaskFullResult);
        finalResults.push(subtaskFullResult);
        subtask.status = 'completed';
        subtask.progress = 100;
        subtask.result = subtaskFullResult;
        await user.save();
      } catch (subtaskError) {
        console.error(`[ComplexTask] Error in subtask ${i + 1}:`, subtaskError);
        hasError = true;
        subtask.status = 'error';
        subtask.progress = 100;
        subtask.error = subtaskError.message;
        await user.save();
        if (i < task.subTasks.length - 1) {
          const shouldContinue = await agent.aiQuery(
            `The previous step (${subtask.command}) failed with error: ${subtaskError.message}. Is it possible to continue with the remaining steps? Answer with just yes or no.`
          );
          if (shouldContinue.toLowerCase().includes('no')) {
            throw new Error(`Could not continue after subtask ${i + 1} failed: ${subtaskError.message}`);
          }
        }
      }
    }

    let finalSummary;
    try {
      finalSummary = await agent.aiQuery(
        "Create a comprehensive summary of all the tasks performed and the results in a human-readable format. Return structured JSON with fields: { summary, subtasks }"
      );
    } catch (summaryError) {
      console.error("[ComplexTask] Error generating final summary:", summaryError);
      finalSummary = { summary: "Failed to generate summary due to an error", error: summaryError.message };
      hasError = true;
    }

    let parsedSummary;
    try {
      parsedSummary = typeof finalSummary === 'string' ? JSON.parse(finalSummary) : finalSummary;
    } catch (parseError) {
      parsedSummary = { summary: "Failed to parse final summary", rawOutput: finalSummary };
      hasError = true;
    }

    const reportPath = path.join(runDir, 'report.html');
    if (!fs.existsSync(reportPath)) {
      fs.writeFileSync(reportPath, `<html><body><h1>Midscene Run Report</h1><p>Task ID: ${taskId}</p><p>Command: ${command}</p></body></html>`);
    }

    const finalResult = {
      raw: finalResults.map(subtask => subtask.raw),
      aiPrepared: { subtasks: finalResults.map(subtask => subtask.aiPrepared), summary: parsedSummary },
      runReport: `/midscene_run/${runId}/report.html`
    };

    task.status = hasError ? 'error' : 'completed';
    task.progress = 100;
    task.endTime = new Date();
    task.result = finalResult;
    task.isDone = true; // Signal completion for the /tasks/:id/stream endpoint
    if (hasError) task.error = "One or more subtasks failed";
    user.history.push({ _id: taskId, url, command, result: finalResult, timestamp: new Date() });
    const taskIndex = user.activeTasks.findIndex(t => t._id.toString() === taskId.toString());
    if (taskIndex !== -1) {
      user.activeTasks.splice(taskIndex, 1);
    }
    await user.save();

    console.log(`[ComplexTask] Task ${taskId} completed with status: ${task.status}`);

    return finalResult;
  } catch (err) {
    console.error("[ComplexTask] Error:", err);
    const user = await User.findById(userId);
    const task = user.activeTasks.find(t => t._id.toString() === taskId.toString());
    if (task) {
      task.status = 'error';
      task.progress = 100;
      task.error = err.message || "Unknown error";
      task.endTime = new Date();
      task.isDone = true; // Signal completion for the /tasks/:id/stream endpoint
      const taskIndex = user.activeTasks.findIndex(t => t._id.toString() === taskId.toString());
      if (taskIndex !== -1) {
        user.activeTasks.splice(taskIndex, 1);
      }
      await user.save();
    }
    throw err;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (closeErr) {
        console.error("[ComplexTask] Error closing browser:", closeErr);
      }
      browser = null;
    }
  }
};

// Natural Language Interaction (NLI) endpoint
app.post('/nli', requireAuth, async (req, res) => {
  const { prompt, url } = req.body;
  if (!prompt) {
    return res.status(400).json({ success: false, error: 'Prompt is required.' });
  }
  // Decide if the prompt likely requires browser automation.
  // This is a simple check – you could improve it based on your requirements.
  const requiresAutomation = /navigate|click|scroll|launch|app|application|program|windows|mac|open/i.test(prompt);
  
  try {
    let nliResult;
    if (requiresAutomation) {
      // Launch browser context if action is needed.
      const targetUrl = url || 'about:blank';
      const browser = await puppeteer.launch({
        headless: false,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1080,768"],
        timeout: 120000
      });
      const page = await browser.newPage();
      await page.setViewport({ width: 1080, height: 768, deviceScaleFactor: process.platform === "darwin" ? 2 : 1 });
      await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 180000 });
      const agent = new PuppeteerAgent(page, { 
        forceSameTabNavigation: true, 
        executionTimeout: 600000, 
        planningTimeout: 300000 
      });
      nliResult = await runAutomation(prompt);
      await browser.close();
    } else {
      // If no automation is required, just run the AI function without a browser.
      nliResult = await runAutomation(prompt);
    }
    const user = await User.findById(req.session.user);
    const historyItem = { url: url || 'about:blank', command: prompt, result: { raw: nliResult, aiPrepared: nliResult }, timestamp: new Date() };
    user.history.push(historyItem);
    await user.save();
    res.json({ success: true, result: nliResult, history: historyItem });
  } catch (err) {
    console.error("[Midscene] Error in /nli:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Serve static pages if logged in
app.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, '/public/index.html'));
});
app.get('/history.html', (req, res) => {
  if (!req.session.user) return res.redirect('/login.html');
  const filePath = path.join(__dirname, 'public', 'history.html');
  fs.existsSync(filePath) ? res.sendFile(filePath) : res.status(404).send('History page not found');
});
app.get('/guide.html', (req, res) => {
  if (!req.session.user) return res.redirect('/login.html');
  const filePath = path.join(__dirname, 'public', 'guide.html');
  fs.existsSync(filePath) ? res.sendFile(filePath) : res.status(404).send('Guide page not found');
});
app.get('/settings.html', (req, res) => {
  if (!req.session.user) return res.redirect('/login.html');
  const filePath = path.join(__dirname, 'public', 'settings.html');
  fs.existsSync(filePath) ? res.sendFile(filePath) : res.status(404).send('Settings page not found');
});

// Start the server
const PORT = process.env.PORT || 3400;
app.listen(PORT, () => {
  console.log("Server started on http://localhost:" + PORT);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  await mongoose.connection.close();
  console.log('Mongoose connection closed');
  process.exit(0);
});
