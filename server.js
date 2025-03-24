// server.js (ESM version)
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
const app = express();

import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import { PuppeteerAgent } from '@midscene/web/puppeteer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import OpenAI from 'openai';

import puppeteerExtra from 'puppeteer-extra';
import { RateLimiterMemory } from 'rate-limiter-flexible';
import pRetry from 'p-retry';
import pTimeout from 'p-timeout';
import clipboardy from 'clipboardy';

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { exec } from 'child_process';

// Advanced control with Nut.js (improved version 22/03/2025 1:17pm)
import nutJs from '@nut-tree-fork/nut-js';
const { 
  keyboard, Key, mouse, Point, Button, screen, 
  imageResource, straightTo, centerOf, Region, window 
} = nutJs;

// Import audio I/O libraries
import Speaker from 'speaker';
import Mic from 'mic';
import textToSpeech from '@google-cloud/text-to-speech';
import speech from '@google-cloud/speech';

// Import NLI Router and Quark components
import { QuarkAgent } from './src/quark/index.js';
import { findElementSmart, retryAction } from './src/quark/utils.js';
import NLIRouter from './src/nli/index.js';
import logger from './src/utils/logger.js';

// Initialize NLI Router and Quark agent
let nliRouter;
let quarkAgent;

// Initialize components on server start
async function initializeComponents() {
  try {
    nliRouter = new NLIRouter();
    await nliRouter.initialize();
    logger.info('NLI Router initialized successfully');

    quarkAgent = new QuarkAgent();
    await quarkAgent.initialize();
    logger.info('Quark agent initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize components:', error);
    throw error;
  }
}

// Initialize on server start
initializeComponents().catch(err => {
  console.error('Failed to initialize components:', err);
  process.exit(1);
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configure Nut.js for advanced control
keyboard.config.autoDelayMs = 100;
mouse.config.autoDelayMs = 100;
mouse.config.mouseSpeed = 1000; // Faster mouse speed

// Initialize the OpenAI client
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Initialize Google Cloud clients
const speechClient = new speech.SpeechClient();
const ttsClient = new textToSpeech.TextToSpeechClient();

// Create directories for run files, reports, and screenshots
const MIDSCENE_RUN_DIR = path.join(__dirname, 'midscene_run');
if (!fs.existsSync(MIDSCENE_RUN_DIR)) fs.mkdirSync(MIDSCENE_RUN_DIR, { recursive: true });
const REPORT_DIR = path.join(MIDSCENE_RUN_DIR, 'report');
if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });
const SCREENSHOT_DIR = path.join(MIDSCENE_RUN_DIR, 'screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

// Serve midscene_run directory statically
app.use('/midscene_run', express.static(MIDSCENE_RUN_DIR));
app.use('/midscene_run/report', express.static(path.join(__dirname, 'midscene', 'report')));

// --- Mongoose Connection & Schema ---
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://dailAdmin:ua5^bRNFCkU*--c@operator.smeax.mongodb.net/?retryWrites=true&w=majority&appName=OPERATOR";
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("Connected to MongoDB via Mongoose"))
  .catch(err => console.error("Mongoose connection error:", err));

// --- Express Middleware ---
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    client: mongoose.connection.getClient(),
    dbName: 'dail',
    collectionName: 'sessions'
  }),
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, secure: process.env.NODE_ENV === 'production' }
}));

// Rate limiter setup
const rateLimiter = new RateLimiterMemory({
  points: 10, // Increased points
  duration: 1, // Per second
});

// --- Enhanced User Schema with subtasks and custom URLs
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

// Add this route to ensure proper content type headers
app.get('/history', requireAuth, async (req, res) => {
  try {
    // Set proper content type header
    res.setHeader('Content-Type', 'application/json');
    
    const user = await User.findById(req.session.user);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    
    // Sort history by timestamp in descending order
    const sortedHistory = user.history.sort((a, b) => 
      new Date(b.timestamp) - new Date(a.timestamp)
    );

    // Format history items with proper structure
    const formattedHistory = sortedHistory.map(item => ({
      _id: item._id,
      url: item.url || 'Unknown URL',
      command: item.command,
      timestamp: item.timestamp,
      result: {
        raw: item.result?.raw || null,
        aiPrepared: item.result?.aiPrepared || null,
        runReport: item.result?.runReport || null
      }
    }));
    
    res.json(formattedHistory);
  } catch (err) {
    console.error('Error fetching history:', err);
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// History by id route
app.get('/history/:id', requireAuth, async (req, res) => {
  try {
    res.setHeader('Content-Type', 'application/json');
    
    const user = await User.findById(req.session.user);
    const historyItem = user.history.find(h => h._id.toString() === req.params.id);
    
    if (!historyItem) {
      return res.status(404).json({ error: 'History item not found' });
    }

    // Format individual history item with same structure
    const formattedItem = {
      _id: historyItem._id,
      url: historyItem.url || 'Unknown URL',
      command: historyItem.command,
      timestamp: historyItem.timestamp,
      result: {
        raw: historyItem.result?.raw || null,
        aiPrepared: historyItem.result?.aiPrepared || null,
        runReport: historyItem.result?.runReport || null
      }
    };
    
    res.json(formattedItem);
  } catch (err) {
    console.error('Error fetching history item:', err);
    res.status(500).json({ error: 'Failed to fetch history item' });
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
      res.write(`data: ${JSON.stringify({ 
        status: task.status, 
        progress: task.progress, 
        subTasks: task.subTasks, 
        intermediateResults: task.intermediateResults, 
        error: task.error, 
        result: task.result 
      })}\n\n`); // ensures the SSE message is correctly formatted with proper JSON serialization and the required \n\n delimiter.

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


// --- Social login handling
async function handleSocialLogin(page, provider) {
  try {
    // Wait for and click social login button
    const buttonSelectors = {
      google: '.google-login-button, [aria-label*="Google"]',
      twitter: '.twitter-login-button, [aria-label*="Twitter"]',
      facebook: '.facebook-login-button, [aria-label*="Facebook"]'
    };

    const selector = buttonSelectors[provider];
    if (!selector) {
      throw new Error(`Unsupported social login provider: ${provider}`);
    }

    // Wait for and click the social login button
    await clickElement(page, selector, {
      timeout: 10000,
      retries: 3
    });

    // Handle popup if needed
    const pages = await page.browser().pages();
    const popup = pages[pages.length - 1];
    
    if (popup && popup !== page) {
      // Switch to popup and handle login
      await popup.waitForNavigation({ waitUntil: 'networkidle0' });
      
      // Wait for login form
      await waitForElement(popup, 'input[type="email"]');
      
      // Let the calling code handle the actual login
      return popup;
    }

    return page;
  } catch (err) {
    logger.error('Social login error:', err);
    throw err;
  }
}

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
    // If the command is already segmented, use each segment as its own subtask.
    const parts = command.split(/\s+then\s+|\.\s+|,\s+/).filter(Boolean);
    subtasks = parts.map((part, index) => ({
      id: `subtask-${index + 1}`,
      command: part.trim(),
      status: 'pending',
      progress: 0
    }));
  } else {
    // For a single command, generate a set of generic steps that cover both browser and app interactions.
    subtasks = [
      { 
        id: 'subtask-1', 
        command: `Analyze the command to determine the context (web or desktop app) and prepare the environment accordingly. Allow extra time for detection.`,
        status: 'pending', 
        progress: 0 
      },
      { 
        id: 'subtask-2', 
        command: `Perform initial navigation and setup actions required by the command. If using a browser, load the page and ensure all elements are visible; if using an application, open and focus the app. Wait for stabilization.`,
        status: 'pending', 
        progress: 0 
      },
      { 
        id: 'subtask-3', 
        command: `Execute the main action of the command. Include advanced mouse and keyboard interactions (e.g. curved mouse moves, drag-and-drop, or complex key combinations) as needed. If an error occurs, wait additional time and retry.`,
        status: 'pending', 
        progress: 0 
      },
      { 
        id: 'subtask-4', 
        command: `Finalize the task by verifying completion and extracting any results. If system-level interactions (e.g. Task Manager, clipboard operations, voice input/output) are needed, perform those and allow extra time before finishing.`,
        status: 'pending', 
        progress: 0 
      }
    ];
  }
  return subtasks;
}

// --- Authentication Middleware ---
function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ success: false, error: 'Not logged in' });
  }
  next();
}

// --- Browser pool management
let browserPool = [];
const MAX_POOL_SIZE = 5; // Increased pool size

// Advanced browser configuration
async function getBrowserWithProtection() {
  try {
    // Try to reuse an existing browser from the pool
    let browser = browserPool.find(b => !b.inUse);
    if (browser) {
      browser.inUse = true;
      logger.info('Reusing browser from pool');
      return browser.instance;
    }

    // Create new browser if pool not full
    if (browserPool.length < MAX_POOL_SIZE) {
      const launchArgs = [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-accelerated-2d-canvas",
        "--disable-3d-apis",
        "--ignore-certificate-errors",
        "--allow-insecure-localhost",
        "--disable-web-security",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--window-size=1366,768",
        "--disable-notifications",
        "--disable-infobars",
        "--disable-blink-features=AutomationControlled" // Hide automation flag
      ];

      const instance = await puppeteerExtra.launch({
        headless: false,
        args: launchArgs,
        defaultViewport: null,
        ignoreHTTPSErrors: true,
        executablePath: process.env.CHROME_PATH,
        // Add stealth enhancements
        stealth: true,
        // Preserve cookies and cache
        userDataDir: path.join(__dirname, 'puppeteer_user_data')
      });

      // Patch browser to remove automation traces
      const pages = await instance.pages();
      const page = pages[0] || await instance.newPage();
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        window.chrome = window.chrome || {};
        window.chrome.runtime = window.chrome.runtime || {};
      });

      browserPool.push({ instance, inUse: true });
      logger.info('Created new browser instance');
      return instance;
    }

    // Wait for available browser if pool is full
    logger.info('Browser pool full, waiting for available browser');
    await new Promise(resolve => setTimeout(resolve, 1000));
    return getBrowserWithProtection();
  } catch (err) {
    logger.error('Error getting browser:', err);
    throw err;
  }
}

function releaseBrowser(browser) {
  const poolEntry = browserPool.find(b => b.instance === browser);
  if (poolEntry) {
    poolEntry.inUse = false;
    logger.info('Released browser back to pool');
  }
}

// Enhanced page setup with retry logic and advanced capabilities
async function setupEnhancedPage(browser, url) {
  const page = await browser.newPage();

  // Set extra HTTP headers for better stealth
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'max-age=0'
  });

  // Configure viewport
  await page.setViewport({
    width: 1366,
    height: 768,
    deviceScaleFactor: process.platform === "darwin" ? 2 : 1
  });

  // Set user agent to avoid detection
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36'
  );

  // Utility functions
  page.utils = {
    sleep: (ms) => new Promise(r => setTimeout(r, ms)),
    screenshot: async (selector = null) => {
      const timestamp = Date.now();
      const filename = `screenshot-${timestamp}.png`;
      const path = `${SCREENSHOT_DIR}/${filename}`;
      if (selector) {
        const element = await page.$(selector);
        if (element) await element.screenshot({ path });
        else await page.screenshot({ path });
      } else {
        await page.screenshot({ path });
      }
      return { path, url: `/midscene_run/screenshots/${filename}` };
    },
    getAllText: async () => page.evaluate(() => document.body.innerText),
    copyToClipboard: async (text) => {
      await clipboardy.write(text);
      return true;
    },
    pasteFromClipboard: async (selector) => {
      const text = await clipboardy.read();
      await page.click(selector);
      await page.keyboard.type(text);
      return text;
    }
  };

  // Set timeouts
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);

  // Navigate with simplified retry logic
  try {
    await pRetry(
      async () => {
        await pTimeout(
          page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 }),
          { milliseconds: 30000 }, // Explicitly pass timeout
          new Error('Navigation timeout')
        );
        // Wait for page stability
        await page.waitForFunction('document.readyState === "complete"', { timeout: 10000 });
      },
      {
        retries: 3, // Reduced retries to avoid excessive attempts
        onFailedAttempt: (error) => {
          logger.warn(`Navigation attempt ${error.attemptNumber} failed: ${error.message}. ${error.retriesLeft} retries left.`);
        }
      }
    );
  } catch (error) {
    logger.error(`Failed to navigate to ${url}: ${error.message}`);
    throw error;
  }

  // Bypass security warnings if present
  await page.evaluate(() => {
    const securityButton = document.querySelector('button#proceed-link, button#details-button, a#proceed-link');
    if (securityButton) securityButton.click();
  });

  return page;
}

// Enhanced mouse movement with curves for human-like motion
async function moveMouseWithCurve(startX, startY, endX, endY, steps = 25) {
  // Bézier curve parameters
  const cp1x = startX + (Math.random() * 0.5 * (endX - startX));
  const cp1y = startY + (Math.random() * (endY - startY));
  const cp2x = startX + (0.5 + Math.random() * 0.5) * (endX - startX);
  const cp2y = startY + (Math.random() * (endY - startY));
  
  // Calculate points along the curve
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    
    const x = a * startX + b * cp1x + c * cp2x + d * endX;
    const y = a * startY + b * cp1y + c * cp2y + d * endY;
    
    // Use robotjs for speed and precision
    robotjs.moveMouse(Math.round(x), Math.round(y));
    
    // Variable delay for human-like movement
    await new Promise(r => setTimeout(r, Math.random() * 5 + 5));
  }
}

// Enhanced element interaction functions
async function waitForElement(page, selector, options = {}) {
  const {
    timeout = 10000,
    visible = true,
    retries = 5
  } = options;

  return pRetry(
    async () => {
      try {
        await page.waitForSelector(selector, { 
          visible,
          timeout 
        });
        return true;
      } catch (error) {
        // AI-powered element finding as fallback
        const pageText = await page.evaluate(() => document.body.innerText);
        const html = await page.evaluate(() => document.body.innerHTML);
        
        // Use OpenAI to suggest alternative selectors
        const response = await openai.chat.completions.create({
          model: "gpt-3.5-turbo",
          messages: [
            {
              role: "system", 
              content: "You are an expert web developer. The following selector failed to find an element. Based on the page content, suggest alternative CSS selectors that might work."
            },
            {
              role: "user",
              content: `Failed selector: ${selector}\nPage text excerpt: ${pageText.slice(0, 1000)}\nHTML excerpt: ${html.slice(0, 1000)}`
            }
          ]
        });
        
        const suggestedSelectors = response.choices[0].message.content
          .match(/`([^`]+)`/g)
          ?.map(s => s.replace(/`/g, '').trim())
          .filter(s => s !== selector && s.length > 0);
        
        if (suggestedSelectors && suggestedSelectors.length > 0) {
          // Try alternative selectors
          for (const altSelector of suggestedSelectors) {
            try {
              await page.waitForSelector(altSelector, { visible, timeout: 5000 });
              logger.info(`Original selector "${selector}" failed, but found element with "${altSelector}"`);
              return altSelector; // Return the working selector
            } catch (err) {
              // Continue to next selector
            }
          }
        }
        
        throw new Error(`Element not found with selector "${selector}" or alternatives`);
      }
    },
    {
      retries,
      onFailedAttempt: error => {
        logger.warn(`Wait attempt ${error.attemptNumber} failed for selector "${selector}". ${error.retriesLeft} retries left.`);
      }
    }
  );
}

// Enhanced drag and drop implementation
async function dragAndDrop(page, sourceSelector, targetSelector, options = {}) {
  const {
    force = false,
    delay = 100
  } = options;
  
  return pRetry(
    async () => {
      // Wait for both elements to be available
      const sourceHandle = await page.waitForSelector(sourceSelector, { visible: true });
      const targetHandle = await page.waitForSelector(targetSelector, { visible: true });
      
      // Get element positions
      const sourceBox = await sourceHandle.boundingBox();
      const targetBox = await targetHandle.boundingBox();
      
      if (!sourceBox || !targetBox) {
        throw new Error('Unable to get element positions for drag and drop');
      }
      
      // Calculate source and target centers
      const sourceX = sourceBox.x + sourceBox.width / 2;
      const sourceY = sourceBox.y + sourceBox.height / 2;
      const targetX = targetBox.x + targetBox.width / 2;
      const targetY = targetBox.y + targetBox.height / 2;
      
      // Option 1: Use page.mouse API (works in most cases)
      await page.mouse.move(sourceX, sourceY);
      await page.mouse.down();
      await page.waitForTimeout(delay);
      
      // Move with curve for realism
      const steps = 10;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        // Add a slight arc to the path for realism
        const arcHeight = 20;
        const arcY = Math.sin(Math.PI * t) * arcHeight;
        
        const x = sourceX + (targetX - sourceX) * t;
        const y = sourceY + (targetY - sourceY) * t - arcY;
        
        await page.mouse.move(x, y);
        await page.waitForTimeout(5);
      }
      
      await page.mouse.up();
      
      // Option 2: Try JavaScript drag events as fallback
      if (force) {
        await page.evaluate((source, target) => {
          const dragSrc = document.querySelector(source);
          const dropTarget = document.querySelector(target);
          
          if (!dragSrc || !dropTarget) return false;
          
          // Create and dispatch drag events
          const dragStartEvent = new MouseEvent('dragstart', { bubbles: true });
          Object.defineProperty(dragStartEvent, 'dataTransfer', {
            value: new DataTransfer(),
          });
          
          const dropEvent = new MouseEvent('drop', { bubbles: true });
          Object.defineProperty(dropEvent, 'dataTransfer', {
            value: new DataTransfer(),
          });
          
          dragSrc.dispatchEvent(dragStartEvent);
          dropTarget.dispatchEvent(dropEvent);
          
          return true;
        }, sourceSelector, targetSelector);
      }
      
      return true;
    },
    { retries: 3 }
  );
}

async function clickElement(page, selector, options = {}) {
  const {
    timeout = 5000,
    retries = 3,
    delay = 100,
    button = 'left',
    doubleClick = false,
    rightClick = false
  } = options;

  return pRetry(
    async () => {
      // First try to locate the element
      const workingSelector = await waitForElement(page, selector, { timeout, retries });
      
      // Get the element's position
      const elementHandle = await page.$(workingSelector || selector);
      if (!elementHandle) {
        throw new Error(`Element not found with selector "${selector}"`);
      }
      
      // Make sure element is in viewport
      await elementHandle.evaluate(el => {
        if (!el.isConnected) throw new Error('Element is detached from DOM');
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      
      await page.waitForTimeout(delay);
      
      // Try different click methods in sequence
      try {
        if (doubleClick) {
          await elementHandle.click({ clickCount: 2 });
        } else if (rightClick) {
          await elementHandle.click({ button: 'right' });
        } else {
          await elementHandle.click({ button });
        }
      } catch (clickError) {
        logger.warn(`Direct click failed: ${clickError.message}. Trying alternative methods.`);
        
        // Fallback 1: Use page.mouse API
        try {
          const box = await elementHandle.boundingBox();
          if (box) {
            const x = box.x + box.width / 2;
            const y = box.y + box.height / 2;
            
            await page.mouse.move(x, y);
            await page.waitForTimeout(50);
            
            if (doubleClick) {
              await page.mouse.click(x, y, { clickCount: 2 });
            } else if (rightClick) {
              await page.mouse.click(x, y, { button: 'right' });
            } else {
              await page.mouse.click(x, y);
            }
          }
        } catch (mouseError) {
          // Fallback 2: Use JavaScript click
          await elementHandle.evaluate(el => el.click());
        }
      }
      
      return true;
    },
    {
      retries,
      onFailedAttempt: error => {
        logger.warn(`Click attempt ${error.attemptNumber} failed for selector "${selector}". ${error.retriesLeft} retries left.`);
      }
    }
  );
}

async function sendSystemKeyCombination(keys) {
  const keySequence = keys.split('+').map(key => Key[key.toUpperCase()]);
  if (!keySequence.every(key => key)) {
    throw new Error(`Invalid key in sequence: ${keys}`);
  }
  try {
    await keyboard.pressKey(...keySequence);
    await keyboard.releaseKey(...keySequence.reverse());
    return true;
  } catch (error) {
    logger.error(`Failed to send system key combination ${keys}: ${error.message}`);
    throw error;
  }
}

async function sendKeyCombination(page, keys) {
  const commonShortcuts = {
    'copy': ['Control', 'c'],
    'paste': ['Control', 'v'],
    'cut': ['Control', 'x'],
    'undo': ['Control', 'z'],
    'redo': ['Control', 'y'],
    'save': ['Control', 's'],
    'find': ['Control', 'f'],
    'selectAll': ['Control', 'a'],
    'taskManager': ['Control', 'Shift', 'Escape'],
    'altTab': ['Alt', 'Tab'],
    'ctrlAltDel': ['Control', 'Alt', 'Delete'],
    'printScreen': ['PrintScreen']
  };
  const keySequence = commonShortcuts[keys] || keys.split('+');
  
  // Handle system-level shortcuts with Nut.js
  if (['ctrlAltDel', 'printScreen', 'altTab', 'taskManager'].includes(keys)) {
    return await sendSystemKeyCombination(keys);
  }
  
  // Handle browser-level shortcuts with Puppeteer
  try {
    for (let i = 0; i < keySequence.length - 1; i++) {
      await page.keyboard.down(keySequence[i]);
    }
    await page.keyboard.press(keySequence[keySequence.length - 1]);
    for (let i = keySequence.length - 2; i >= 0; i--) {
      await page.keyboard.up(keySequence[i]);
    }
    return true;
  } catch (error) {
    logger.error(`Failed to send browser key combination ${keys}: ${error.message}`);
    throw error;
  }
}

// === System Control via robotjs ===
async function systemControl(command, options = {}) {
  try {
    switch (command) {
      case 'getScreenSize':
        const width = await screen.width();
        const height = await screen.height();
        return { width, height };
        
      case 'getMousePosition':
        const pos = await mouse.getPosition();
        return { x: pos.x, y: pos.y };
        
      case 'moveMouse':
        const target = new Point(options.x, options.y);
        if (options.curve) {
          await mouse.move(straightTo(target));
        } else {
          await mouse.setPosition(target);
        }
        return true;
        
      case 'mouseClick':
        const button = options.button === 'right' ? Button.RIGHT : Button.LEFT;
        await mouse.click(button);
        if (options.double) {
          await mouse.click(button);
        }
        return true;
        
      case 'mouseToggle':
        const state = options.down ? 'down' : 'up';
        const toggleButton = options.button === 'right' ? Button.RIGHT : Button.LEFT;
        if (state === 'down') {
          await mouse.pressButton(toggleButton);
        } else {
          await mouse.releaseButton(toggleButton);
        }
        return true;
        
      case 'dragMouse':
        const dragTarget = new Point(options.x, options.y);
        await mouse.drag(straightTo(dragTarget));
        return true;
        
      case 'scrollMouse':
        const direction = options.direction || 'up';
        const amount = options.amount || 1;
        await mouse.scroll(direction, amount);
        return true;
        
      case 'typeString':
        await keyboard.type(options.text);
        return true;
        
      case 'keyTap':
        const key = Key[options.key.toUpperCase()];
        if (!key) throw new Error(`Unknown key: ${options.key}`);
        const modifiers = options.modifiers ? options.modifiers.map(mod => Key[mod.toUpperCase()]) : [];
        await keyboard.pressKey(...modifiers, key);
        await keyboard.releaseKey(...modifiers, key);
        return true;
        
      case 'keyToggle':
        const toggleKey = Key[options.key.toUpperCase()];
        if (!toggleKey) throw new Error(`Unknown key: ${options.key}`);
        const toggleModifiers = options.modifiers ? options.modifiers.map(mod => Key[mod.toUpperCase()]) : [];
        if (options.down) {
          await keyboard.pressKey(...toggleModifiers, toggleKey);
        } else {
          await keyboard.releaseKey(...toggleModifiers, toggleKey);
        }
        return true;
        
      case 'getPixelColor':
        const colorPoint = new Point(options.x, options.y);
        const color = await screen.colorAt(colorPoint);
        return color.toHex();
        
      case 'captureScreen':
        const region = new Region(options.x || 0, options.y || 0, options.width || await screen.width(), options.height || await screen.height());
        const screenshot = await screen.grabRegion(region);
        const timestamp = Date.now();
        const filename = `screen-${timestamp}.png`;
        const imagePath = path.join(SCREENSHOT_DIR, filename);
        await screenshot.toFile(imagePath);
        return {
          path: imagePath,
          url: `/midscene_run/screenshots/${filename}`
        };
        
      case 'focusWindow':
        const appWindow = await window.findWindow(options.windowTitle);
        if (appWindow) {
          await window.setActiveWindow(appWindow);
          return `Focused ${options.windowTitle}`;
        }
        throw new Error(`Window "${options.windowTitle}" not found`);
        
      default:
        throw new Error(`Unknown system control command: ${command}`);
    }
  } catch (error) {
    logger.error(`System control error (${command}): ${error.message}`);
    throw error;
  }
}

// === Advanced Voice Interaction ===
async function listenForVoice(durationMs = 5000) {
  return new Promise((resolve, reject) => {
    try {
      const micInstance = Mic({
        rate: '16000',
        channels: '1',
        debug: false,
        fileType: 'wav'
      });
      const micInputStream = micInstance.getAudioStream();
      const chunks = [];
      micInputStream.on('data', (data) => { chunks.push(data); });
      micInputStream.on('error', (err) => { micInstance.stop(); reject(err); });
      micInstance.start();
      setTimeout(async () => {
        micInstance.stop();
        const buffer = Buffer.concat(chunks);
        const [response] = await speechClient.recognize({
          audio: { content: buffer.toString('base64') },
          config: { encoding: 'LINEAR16', sampleRateHertz: 16000, languageCode: 'en-US' }
        });
        const transcription = response.results.map(result => result.alternatives[0].transcript).join('\n');
        resolve(transcription);
      }, durationMs);
    } catch (error) {
      reject(error);
    }
  });
}

async function speakText(text) {
  try {
    const [response] = await ttsClient.synthesizeSpeech({
      input: { text },
      voice: { languageCode: 'en-US', ssmlGender: 'NEUTRAL' },
      audioConfig: { audioEncoding: 'MP3' }
    });
    return new Promise((resolve, reject) => {
      const speaker = new Speaker({ channels: 1, bitDepth: 16, sampleRate: 24000 });
      speaker.on('close', () => { resolve(true); });
      speaker.on('error', (err) => { reject(err); });
      speaker.write(Buffer.from(response.audioContent));
      speaker.end();
    });
  } catch (error) {
    logger.error(`Text-to-speech error: ${error.message}`);
    throw error;
  }
}

// === Advanced OpenAI Function Calling Integration ===
// Define advanced function schemas – these expose our superhuman capabilities
const advancedFunctions = [
  {
    type: "function",
    function: {
      name: "send_key_combination",
      description: "Send a keyboard shortcut or combination to the browser or system.",
      parameters: {
        type: "object",
        properties: {
          keys: { type: "string", description: "A '+'-delimited string representing keys (e.g. 'Control+Alt+Delete')" },
          target: { type: "string", enum: ["browser", "system"], description: "Where to send the key combination" }
        },
        required: ["keys", "target"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "launch_application",
      description: "Launch a desktop application.",
      parameters: {
        type: "object",
        properties: {
          appName: { type: "string", description: "Name or path of the application to launch" }
        },
        required: ["appName"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "focus_window",
      description: "Focus a specific window by its title into view so you can work or act on it.",
      parameters: {
        type: "object",
        properties: {
          windowTitle: { type: "string", description: "Title of the window to focus" }
        },
        required: ["windowTitle"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "browser_navigate",
      description: "Open a page on the browser to a specified URL.",
      parameters: {
        type: "object",
        properties: { url: { type: "string", description: "The URL to navigate to" } },
        required: ["url"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "click_element",
      description: "Click an area or element or button etc, for web its identified by a CSS selector. for Desktop use screensize and mouse location.",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "The CSS selector of the element to click (e.g., '#id', '.class', 'tag')." }
        },
        required: ["selector"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "input_text",
      description: "Type text into a selected input field.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "CSS selector for the input field" },
          text: { type: "string", description: "Text to input" }
        },
        required: ["query", "text"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "move_mouse_with_curve",
      description: "Move the mouse cursor from a starting point to an ending point using a smooth Bézier curve.",
      parameters: {
        type: "object",
        properties: {
          startX: { type: "number", description: "The starting X coordinate of the mouse." },
          startY: { type: "number", description: "The starting Y coordinate of the mouse." },
          endX: { type: "number", description: "The ending X coordinate of the mouse." },
          endY: { type: "number", description: "The ending Y coordinate of the mouse." },
          steps: { type: "number", description: "Number of steps for the curve (default 25)." }
        },
        required: ["startX", "startY", "endX", "endY"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_screen_size",
      description: "Retrieve the width and height of the screen in pixels.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "get_mouse_position",
      description: "Return the current X and Y coordinates of the mouse cursor.",
      parameters: { type: "object", properties: {} }
    }
  },
  {
    type: "function",
    function: {
      name: "mouse_click",
      description: "Simulate a mouse click at the current cursor position.",
      parameters: {
        type: "object",
        properties: {
          button: { type: "string", enum: ["left", "right", "middle"], description: "Mouse button to click (default 'left')." },
          double: { type: "boolean", description: "Whether to double click (default false)." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "mouse_toggle",
      description: "Press or release a mouse button.",
      parameters: {
        type: "object",
        properties: {
          down: { type: "boolean", description: "True to press, false to release." },
          button: { type: "string", enum: ["left", "right", "middle"], description: "Mouse button (default 'left')." }
        },
        required: ["down"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "drag_mouse",
      description: "Drag the mouse to a specified position.",
      parameters: {
        type: "object",
        properties: {
          x: { type: "number", description: "X coordinate to drag to." },
          y: { type: "number", description: "Y coordinate to drag to." }
        },
        required: ["x", "y"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "scroll_mouse",
      description: "Scroll the mouse wheel. Navigate the active window by scrolling the mouse wheel.",
      parameters: {
        type: "object",
        properties: {
          direction: { type: "string", enum: ["up", "down", "left", "right"], description: "Scroll direction." },
          amount: { type: "number", description: "Scroll amount (default 1)." }
        },
        required: ["direction"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "type_string",
      description: "Type a string of text at the current cursor position. Move window into focus, then position cursor, then type.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text to type." }
        },
        required: ["text"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "key_tap",
      description: "Trigger a single key press.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "Key to press (e.g., 'Enter', 'a')." },
          modifiers: { type: "array", items: { type: "string" }, description: "Modifiers (e.g., 'Control')." }
        },
        required: ["key"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "key_toggle",
      description: "Press or release a key.",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "Key to toggle." },
          down: { type: "boolean", description: "True to press, false to release." },
          modifiers: { type: "array", items: { type: "string" }, description: "Modifiers." }
        },
        required: ["key", "down"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_pixel_color",
      description: "Retrieve the color of a pixel at a position.",
      parameters: {
        type: "object",
        properties: {
          x: { type: "number", description: "X coordinate." },
          y: { type: "number", description: "Y coordinate." }
        },
        required: ["x", "y"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "drag_and_drop",
      description: "Perform a drag-and-drop operation.",
      parameters: {
        type: "object",
        properties: {
          source: { type: "string", description: "CSS selector for source element." },
          target: { type: "string", description: "CSS selector for target element." }
        },
        required: ["source", "target"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "system_control",
      description: "Execute a system-level command.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "System control command." },
          options: { type: "object", description: "Additional options." }
        },
        required: ["command"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "listen_voice",
      description: "Listen for voice input and convert to text.",
      parameters: {
        type: "object",
        properties: {
          duration: { type: "number", description: "Duration in milliseconds." }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "speak_text",
      description: "Convert text to speech.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text to speak." }
        },
        required: ["text"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "clipboard_copy",
      description: "Copy text to the system clipboard.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text to copy." }
        },
        required: ["text"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "clipboard_paste",
      description: "Paste text from clipboard into an element.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "CSS selector for target element." }
        },
        required: ["query"]
      }
    }
  }
];

// Advanced system prompt for superhuman task execution
const SYSTEM_PROMPT_SUPERHUMAN = `
Your name is O.P.E.R.A.T.O.R. (not OpenAI Operator but a Crypto Version). You are a superhuman automation agent controlling a computer, designed to mimic human behavior with natural pacing and precision.
Your capabilities include:
- Browser automation: navigating, clicking, typing, etc.
- Desktop automation: controlling mouse, keyboard, launching applications, etc.
- Smooth, human-like mouse movements using curved paths for drag-and-drop.
- Full keyboard automation with support for complex key combinations (e.g., Control+Alt+Delete, copy, paste, cut).
- Taking and processing screenshots.
- Clipboard operations (copy, paste, cut).
- Voice interaction: listening through the microphone and speaking via speakers.
- System control functions like opening Task Manager or other system-level operations.
When given a natural language task:
1. Break it into clear, sequential sub-tasks that a human might follow.
2. Always bring relevnt window into focus, then scroll to relevant section or area.
3. Use mouse movements to adjust winodw position, select text area, etc for faster movement.
4. Include occasional pauses to simulate thinking or reading.
5. Handle errors by retrying with slight variations (e.g., alternative selectors or navigation paths).
Output a structured JSON plan with:
- \`plan\`: A step-by-step outline.
- \`actions\`: An array of function calls with parameters using the provided schemas.
Ensure your JSON is valid and executable.
`;

const humanLikeDelay = async (min, max) => {
  const delay = min + Math.random() * (max - min);
  await new Promise(resolve => setTimeout(resolve, delay));
  return delay;
};

// === OpenAI Function Calling using advancedFunctions and SYSTEM_PROMPT_SUPERHUMAN ===

async function runAdvancedAutomation(userInstruction, page = null) {
  const messages = [
    { role: "system", content: SYSTEM_PROMPT_SUPERHUMAN },
    { role: "user", content: userInstruction }
  ];

  let maxIterations = 10;
  let iteration = 0;

  while (iteration < maxIterations) {
    iteration++;
    try {
      const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: messages,
        tools: advancedFunctions, // Always included
        tool_choice: "auto",
        temperature: 0.7,
      });

      const reply = response.choices[0].message;
      logger.info(`[Automation] Iteration ${iteration}: ${JSON.stringify(reply)}`);

      if (!reply.tool_calls || reply.tool_calls.length === 0) {
        return reply.content || "Task completed with no further instructions";
      }

      messages.push(reply);

      for (const toolCall of reply.tool_calls) {
        const funcName = toolCall.function.name;
        const args = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {};
        let funcResult;

        logger.info(`[Automation] Executing tool: ${funcName} with args: ${JSON.stringify(args)}`);

        try {
          switch (funcName) {
            case "click_element":
                if (!page) throw new Error("Browser page not available");
                if (!args.selector) throw new Error("Selector is required");
                const element = await page.$(args.selector);
                if (!element) throw new Error(`Element "${args.selector}" not found`);
                const box = await element.boundingBox();
                if (!box) throw new Error(`Cannot get position of "${args.selector}"`);
                const startPos = await mouse.getPosition();
                const targetX = box.x + box.width / 2;
                const targetY = box.y + box.height / 2;
                await moveMouseWithCurve(startPos.x, startPos.y, targetX, targetY, 25);
                await page.mouse.click(targetX, targetY, {
                  button: args.button || "left",
                  clickCount: args.doubleClick ? 2 : 1
                });
                funcResult = { result: `Clicked element "${args.selector}"` };
                await humanLikeDelay(300, 1000);
                break;

              case "input_text":
                if (!page) throw new Error("Browser page not available");
                if (!args.query || !args.text) throw new Error("Query selector and text are required");
                await page.click(args.query); // Focus the field
                for (const char of args.text) {
                  await page.keyboard.press(char);
                  await humanLikeDelay(50, 150); // 50-150ms per key
                }
                funcResult = { result: `Entered text into "${args.query}"` };
                await humanLikeDelay(300, 1000);
                break;

              case "drag_and_drop":
                if (!page) throw new Error("Browser page not available");
                if (!args.source || !args.target) throw new Error("Source and target selectors are required");
                const sourceBox = await page.boundingBox(args.source);
                const targetBox = await page.boundingBox(args.target);
                if (!sourceBox || !targetBox) throw new Error("Source or target element not found");
                await moveMouseWithCurve(
                  sourceBox.x + sourceBox.width / 2,
                  sourceBox.y + sourceBox.height / 2,
                  targetBox.x + targetBox.width / 2,
                  targetBox.y + targetBox.height / 2
                );
                funcResult = { result: `Dragged from "${args.source}" to "${args.target}"` };
                break;

              case "send_key_combination":
                if (!args.keys) throw new Error("Keys are required");
                if (args.target === "browser") {
                  if (!page) throw new Error("Browser page not available");
                  const keySequence = args.keys.split("+").join(" ");
                  await page.keyboard.press(keySequence);
                  funcResult = { result: `Sent "${args.keys}" to browser` };
                } else if (args.target === "system" || !args.target) {
                  const keys = args.keys.split("+").map(k => {
                    const key = Key[k.trim().toUpperCase()];
                    if (!key) throw new Error(`Invalid key: ${k}`);
                    return key;
                  });
                  await keyboard.pressKey(...keys);
                  await keyboard.releaseKey(...keys);
                  funcResult = { result: `Sent "${args.keys}" to system` };
                } else {
                  throw new Error(`Invalid target: ${args.target}`);
                }
                break;

              // System Control Functions (moved from systemControl)
              case "browser_navigate":
                if (!page) throw new Error("Browser page not available");
                if (!args.url) throw new Error("URL is required");
                await page.goto(args.url, { waitUntil: "networkidle2" });
                funcResult = { result: `Navigated to ${args.url}` };
                await humanLikeDelay(500, 2000);
                break;
              case "get_screen_size":
                const width = await screen.width();
                const height = await screen.height();
                funcResult = { result: { width, height } };
                break;

              case "get_mouse_position":
                const pos = await mouse.getPosition();
                funcResult = { result: { x: pos.x, y: pos.y } };
                break;

              case "move_mouse_with_curve":
                if (!args.startX || !args.startY || !args.endX || !args.endY) {
                  throw new Error("startX, startY, endX, and endY are required");
                }
                await moveMouseWithCurve(args.startX, args.startY, args.endX, args.endY, args.steps || 25);
                funcResult = { result: `Moved mouse from (${args.startX}, ${args.startY}) to (${args.endX}, ${args.endY})` };
                break;

              case "mouse_click":
                const clickButton = args.button === "right" ? Button.RIGHT : args.button === "middle" ? Button.MIDDLE : Button.LEFT;
                await mouse.click(clickButton);
                if (args.double) await mouse.click(clickButton);
                funcResult = { result: `Clicked ${args.button || "left"} button${args.double ? " twice" : ""}` };
                break;

              case "mouse_toggle":
                if (typeof args.down !== "boolean") throw new Error("down parameter (true/false) is required");
                const toggleButton = args.button === "right" ? Button.RIGHT : args.button === "middle" ? Button.MIDDLE : Button.LEFT;
                if (args.down) {
                  await mouse.pressButton(toggleButton);
                } else {
                  await mouse.releaseButton(toggleButton);
                }
                funcResult = { result: `${args.down ? "Pressed" : "Released"} ${args.button || "left"} button` };
                break;

              case "drag_mouse":
                if (!args.x || !args.y) throw new Error("x and y coordinates are required");
                const dragTarget = new Point(args.x, args.y);
                await mouse.drag(straightTo(dragTarget));
                funcResult = { result: `Dragged mouse to (${args.x}, ${args.y})` };
                break;

              case "scroll_mouse":
                if (!args.direction) throw new Error("direction is required");
                const direction = args.direction.toLowerCase();
                if (!["up", "down", "left", "right"].includes(direction)) {
                  throw new Error("direction must be 'up', 'down', 'left', or 'right'");
                }
                const amount = args.amount || 1;
                await mouse.scroll(direction, amount);
                funcResult = { result: `Scrolled ${direction} by ${amount}` };
                break;

              case "type_string":
                if (!args.text) throw new Error("Text is required");
                await keyboard.type(args.text);
                funcResult = { result: `Typed "${args.text}"` };
                break;

              case "key_tap":
                  if (!args.key) throw new Error("key is required");
                  const key = Key[args.key.toUpperCase()];
                  if (!key) throw new Error(`Unknown key: ${args.key}`);
                  const modifiers = args.modifiers ? args.modifiers.map(mod => {
                    const modKey = Key[mod.toUpperCase()];
                    if (!modKey) throw new Error(`Unknown modifier: ${mod}`);
                    return modKey;
                  }) : [];
                  await keyboard.pressKey(...modifiers, key);
                  await keyboard.releaseKey(...modifiers, key);
                  funcResult = { result: `Tapped key "${args.key}"${modifiers.length ? " with modifiers" : ""}` };
                  break;

              case "key_toggle":
                if (!args.key || typeof args.down !== "boolean") throw new Error("key and down (true/false) are required");
                const toggleKey = Key[args.key.toUpperCase()];
                if (!toggleKey) throw new Error(`Unknown key: ${args.key}`);
                const toggleModifiers = args.modifiers ? args.modifiers.map(mod => {
                  const modKey = Key[mod.toUpperCase()];
                  if (!modKey) throw new Error(`Unknown modifier: ${mod}`);
                  return modKey;
                }) : [];
                if (args.down) {
                  await keyboard.pressKey(...toggleModifiers, toggleKey);
                } else {
                  await keyboard.releaseKey(...toggleModifiers, toggleKey);
                }
                funcResult = { result: `${args.down ? "Pressed" : "Released"} key "${args.key}"${toggleModifiers.length ? " with modifiers" : ""}` };
                break;

              case "get_pixel_color":
                if (!args.x || !args.y) throw new Error("x and y coordinates are required");
                const colorPoint = new Point(args.x, args.y);
                const color = await screen.colorAt(colorPoint);
                funcResult = { result: color.toHex() };
                break;

              case "capture_screen":
                const region = new Region(
                  args.x || 0,
                  args.y || 0,
                  args.width || await screen.width(),
                  args.height || await screen.height()
                );
                const screenshot = await screen.grabRegion(region);
                const timestamp = Date.now();
                const filename = `screen-${timestamp}.png`;
                const imagePath = path.join(SCREENSHOT_DIR, filename);
                await screenshot.toFile(imagePath);
                funcResult = { result: { path: imagePath, url: `/midscene_run/screenshots/${filename}` } };
                break;

              case "focus_window":
                if (!args.windowTitle) throw new Error("windowTitle is required");
                const appWindow = await window.findWindow(args.windowTitle);
                if (appWindow) {
                  await window.setActiveWindow(appWindow);
                  funcResult = { result: `Focused ${args.windowTitle}` };
                } else {
                  throw new Error(`Window "${args.windowTitle}" not found`);
                }
                break;

              case "launch_application":
                if (!args.appName) throw new Error("Application name is required");
                funcResult = { result: await launchApplication(args.appName) };
                break;

              // Voice Interaction
              case "listen_voice":
                funcResult = { result: await listenForVoice(args.duration || 5000) };
                break;

              case "speak_text":
                if (!args.text) throw new Error("Text is required");
                await speakText(args.text);
                funcResult = { result: `Spoke: "${args.text}"` };
                break;

              // Clipboard Operations
              case "clipboard_copy":
                if (!args.text) throw new Error("Text is required");
                await clipboardy.write(args.text);
                funcResult = { result: `Copied to clipboard: "${args.text}"` };
                break;

              case "clipboard_paste":
                if (!page) throw new Error("Browser page not available");
                if (!args.query) throw new Error("Query selector is required");
                const pastedText = await clipboardy.read();
                await page.type(args.query, pastedText);
                funcResult = { result: `Pasted into "${args.query}": "${pastedText}"` };
                break;

              default:
                throw new Error(`Unknown function: ${funcName}`);
          }
        } catch (error) {
          funcResult = { error: error.message };
          logger.error(`Tool ${funcName} failed: ${error.message}`);
        }

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(funcResult),
        });
      }

      messages.push({
        role: "system",
        content: "Review the task progress and results. Are there more steps to complete? If not, respond without tool calls.",
      });

    } catch (error) {
      logger.error("Error in runAdvancedAutomation:", error);
      messages.push({
        role: "system",
        content: `An error occurred: ${error.message}. Adjust the plan or confirm task completion.`,
      });
      return `Error executing task: ${error.message}`;
    }
  }

  return "Task incomplete after maximum iterations";
}

async function launchApplication(appName) {
  return new Promise((resolve, reject) => {
    let command;
    if (process.platform === 'win32') {
      command = `start "" "${appName}"`;
    } else if (process.platform === 'darwin') {
      command = `open -a "${appName}"`;
    } else {
      command = appName;
    }
    exec(command, (error) => {
      if (error) {
        reject(new Error(`Failed to launch ${appName}: ${error.message}`));
      } else {
        resolve(`Launched ${appName}`);
      }
    });
  });
}

// === Endpoints ===
// (Truncate unchanged endpoints like /register, /login, /logout, /history, /tasks, etc.)
// ... unchanged code for endpoints ...

/* === old /automate Endpoint (Advanced Version) ===
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

  // Immediately respond so the client UI can update
  res.json({ success: true, taskId, isComplex });

  let browser;
  try {
    logger.info(`[Midscene] Starting task ${taskId} for URL: ${url}`);
    await updateTaskStatus(req.session.user, taskId, 'processing', 10);

    // Use our advanced browser functions:
    browser = await getBrowserWithProtection();
    const page = await setupEnhancedPage(browser, url);
    const agent = new PuppeteerAgent(page, {
      forceSameTabNavigation: true,
      executionTimeout: 600000,
      planningTimeout: 300000
    });
    
    await updateTaskStatus(req.session.user, taskId, 'processing', 20);
    // Let the page settle
    await page.waitForTimeout(4000);
    await updateTaskStatus(req.session.user, taskId, 'processing', 30);
    logger.info("[Midscene] Using configured OpenAI API key:", process.env.OPENAI_API_KEY ? "Yes" : "No");

    // Generate a unique run id and folder for this task’s files
    const runId = uuidv4();
    const runDir = path.join(MIDSCENE_RUN_DIR, runId);
    fs.mkdirSync(runDir, { recursive: true });
    
    if (isComplex) {
      logger.info("[Midscene] Processing complex task with subtasks");
      let finalResults = [];
      let hasError = false;
      
      // Iterate over subTasks (complex branch)
      for (let i = 0; i < subTasks.length; i++) {
        const subtask = subTasks[i];
        logger.info(`[Midscene] Starting subtask ${i + 1}/${subTasks.length}: ${subtask.command}`);
        try {
          await updateSubTask(req.session.user, taskId, subtask.id, { status: 'processing', progress: 10 });
          const overallProgress = Math.floor(30 + ((i / subTasks.length) * 60));
          await updateTaskStatus(req.session.user, taskId, 'processing', overallProgress);
          await page.waitForTimeout(2000);
          await page.evaluate(() => new Promise(resolve => {
            if (document.readyState === 'complete') resolve();
            else window.addEventListener('load', resolve);
          }));
          try {
            await agent.aiAction(subtask.command);
          } catch (actionError) {
            if (actionError.message.includes("Element not found")) {
              logger.info("[Midscene] Element not found, trying alternate approach...");
              await agent.aiAction("Check if we need to navigate to a delegation section first, or look for alternative UI elements");
            } else {
              throw actionError;
            }
          }
          await page.waitForTimeout(2000);
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
            hasError = true;
          }
          const subtaskFullResult = {
            raw: { screenshotPath: `/midscene_run/${runId}/subtask-${i + 1}.png`, pageText: subtaskPageText },
            aiPrepared: parsedSubtaskResult,
            runReport: `/midscene_run/${runId}/report.html`
          };
          await addIntermediateResult(req.session.user, taskId, subtaskFullResult);
          finalResults.push(subtaskFullResult);
          await updateSubTask(req.session.user, taskId, subtask.id, { status: 'completed', progress: 100, result: subtaskFullResult });
        } catch (subtaskError) {
          logger.error(`[Midscene] Error in subtask ${i + 1}:`, subtaskError);
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
        logger.error("[Midscene] Error generating final summary:", summaryError);
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
      logger.info("[Midscene] Executing simple task with command:", command);
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
        await page.waitForTimeout(2000);
        await updateTaskStatus(req.session.user, taskId, 'processing', 80);
        const screenshot = await page.screenshot({ encoding: 'base64' });
        const pageText = await page.evaluate(() => document.body.innerText);
        const runId = uuidv4();
        const runDir = path.join(MIDSCENE_RUN_DIR, runId);
        fs.mkdirSync(runDir, { recursive: true });
        
        let result;
        try {
          result = await agent.aiQuery(
            "Summarize what you did and the result in a human-readable format. Format as JSON with fields: { success, summary, data }"
          );
        } catch (queryError) {
          logger.error("[Midscene] Error in aiQuery:", queryError);
          result = await agent.aiQuery("Describe the actions and result in JSON format.");
          hasError = true;
        }
        let parsedResult;
        try {
          parsedResult = typeof result === 'string' ? JSON.parse(result) : result;
        } catch (parseError) {
          logger.info("[Midscene] Failed to parse AI result as JSON, storing fallback");
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
        logger.error("[Midscene] Error in simple task execution:", actionError);
        logger.info("[Midscene] Converting to complex task and retrying...");
        await User.updateOne(
          { _id: req.session.user, 'activeTasks._id': taskId },
          { $set: { 'activeTasks.$.isComplex': true, 'activeTasks.$.subTasks': splitIntoSubTasks(command) } }
        );
        await updateTaskStatus(req.session.user, taskId, 'processing', 40);
        if (browser) { await browser.close(); browser = null; }
        const automateComplexJob = await automateComplexTask(req.session.user, taskId, url, command);
        return;
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
    logger.error("[Midscene] Error in /automate:", err);
    await updateTaskStatus(req.session.user, taskId, 'error', 100, err.message || "Unknown error");
    await User.updateOne({ _id: req.session.user }, { $pull: { activeTasks: { _id: taskId } } });
  } finally {
    if (browser) {
      try {
        await browser.close();
        releaseBrowser(browser); 
      } catch (closeErr) {
        logger.error("[Midscene] Error closing browser:", closeErr);
      }
      browser = null; // Explicitly nullify to prevent reuse
    }
  }
});
*/

// Updated automate route to use NLI
app.post('/automate', requireAuth, async (req, res) => {
  const { url, command, type = 'manual' } = req.body;
  
  if (!command) {
    return res.status(400).json({ 
      success: false, 
      error: 'Command is required.' 
    });
  }

  const taskId = new ObjectId();
  const user = await User.findById(req.session.user);
  
  // Create task record
  user.activeTasks.push({
    _id: taskId,
    url,
    command,
    status: 'pending',
    progress: 0,
    startTime: new Date(),
    type
  });
  
  await user.save();
  res.json({ success: true, taskId });

  try {
    logger.info(`Starting ${type} task: ${command}`);
    await updateTaskProgress(req.session.user, taskId, 10, { 
      status: 'processing' 
    });

    const result = await executeTask(url, command, type);
    
    // Store result
    await User.updateOne(
      { _id: req.session.user },
      { 
        $push: { 
          history: { 
            _id: taskId, 
            url, 
            command, 
            result, 
            type,
            timestamp: new Date() 
          } 
        }
      }
    );

    await User.updateOne(
      { _id: req.session.user },
      { $pull: { activeTasks: { _id: taskId } } }
    );

    await updateTaskProgress(req.session.user, taskId, 100, {
      status: 'completed',
      endTime: new Date()
    });
  } catch (error) {
    await handleQuarkError(error, req.session.user, taskId);
    await User.updateOne(
      { _id: req.session.user },
      { $pull: { activeTasks: { _id: taskId } } }
    );
  }
});

// NLI endpoint using advanced automation: Main Entry
app.post('/nli', requireAuth, async (req, res) => {
  const { prompt } = req.body;
  
  if (!prompt) {
    return res.status(400).json({ 
      success: false, 
      error: 'Prompt is required' 
    });
  }

  try {
    const sessionId = req.session.id;
    const result = await nliRouter.processInput(prompt, sessionId, {
      userId: req.session.user,
      screenshot: true
    });

    // Add to user's history
    await User.updateOne(
      { _id: req.session.user },
      { 
        $push: { 
          history: {
            _id: new ObjectId(),
            command: prompt,
            result: result.result,
            timestamp: new Date()
          }
        }
      }
    );

    res.json({ 
      success: true, 
      result: result.result,
      sessionState: result.sessionState
    });
  } catch (error) {
    logger.error('NLI processing error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Enhanced task execution with NLI support
async function executeTask(url, command, type = 'manual') {
  try {
    // Use NLI Router for command processing
    const sessionId = uuidv4(); // Generate temporary session ID
    const nliResult = await nliRouter.processInput(command, sessionId, {
      type,
      url,
      screenshot: true
    });

    // Extract execution result
    const executionResult = nliResult.result;

    // Format result for client
    return {
      raw: executionResult.raw || {},
      aiPrepared: executionResult.aiPrepared || {},
      runReport: executionResult.runReport,
      type: executionResult.type,
      timestamp: new Date()
    };
  } catch (error) {
    logger.error('Task execution error:', error);
    throw error;
  }
}

export default async function automateComplexTask(userId, taskId, url, command) {
  const User = mongoose.model('User');
  let browser;
  let context; // incognito context
  try {
    const user = await User.findById(userId);
    const task = user.activeTasks.find(t => t._id.toString() === taskId.toString());
    if (!task || !task.isComplex || !task.subTasks || task.subTasks.length === 0) {
      throw new Error("Task not found or not properly configured as complex");
    }

    console.log(`[ComplexTask] Starting complex task for user ${userId}, task ${taskId}`);

    // Launch an advanced browser instance using our new function
    browser = await getBrowserWithProtection();
    // Create an incognito context for enhanced security
    context = await browser.createIncognitoBrowserContext();
    // Setup an enhanced page from the context
    const page = await setupEnhancedPage(context, url);

    // Instantiate advanced agent on the enhanced page
    const agent = new PuppeteerAgent(page, { 
      forceSameTabNavigation: true, 
      executionTimeout: 600000, 
      planningTimeout: 300000 
    });

    // Wait for the page to load and settle
    await page.waitForTimeout(4000);

    const runId = uuidv4();
    const runDir = path.join(MIDSCENE_RUN_DIR, runId);
    fs.mkdirSync(runDir, { recursive: true });

    let finalResults = [];
    let hasError = false;

    // Process each subtask sequentially using the advanced agent
    for (let i = 0; i < task.subTasks.length; i++) {
      const subtask = task.subTasks[i];
      console.log(`[ComplexTask] Processing subtask ${i + 1}/${task.subTasks.length}: ${subtask.command}`);
      try {
        await updateSubTask(req.session.user, taskId, subtask.id, { status: 'processing', progress: 10 });
        const overallProgress = Math.floor(30 + ((i / task.subTasks.length) * 60));
        await updateTaskStatus(req.session.user, taskId, 'processing', overallProgress);

        await page.waitForTimeout(2000);
        await page.evaluate(() => new Promise(resolve => {
          if (document.readyState === 'complete') resolve();
          else window.addEventListener('load', resolve);
        }));

        // Try executing the subtask via the advanced agent
        try {
          await agent.aiAction(subtask.command);
        } catch (actionError) {
          if (actionError.message.includes("Element not found")) {
            console.log("[ComplexTask] Element not found, trying alternate approach...");
            await agent.aiAction("Check if we need to navigate to a delegation section first, or look for alternative UI elements");
          } else {
            throw actionError;
          }
        }
        await page.waitForTimeout(2000);

        // Take a screenshot (advanced page utilities could be used here as well)
        const subtaskScreenshot = await page.screenshot({ encoding: 'base64' });
        const subtaskPageText = await page.evaluate(() => document.body.innerText);
        const screenshotPath = path.join(runDir, `subtask-${i + 1}.png`);
        fs.writeFileSync(screenshotPath, Buffer.from(subtaskScreenshot, 'base64'));

        // Query the agent for a human-readable description
        const subtaskResult = await agent.aiQuery(
          "Describe what you just accomplished in this step in a human-readable format. Format as JSON with fields: { step, success, summary, data }"
        );
        let parsedSubtaskResult;
        try {
          parsedSubtaskResult = typeof subtaskResult === 'string' ? JSON.parse(subtaskResult) : subtaskResult;
        } catch (parseError) {
          parsedSubtaskResult = { step: `Subtask ${i + 1}`, success: false, summary: "Failed to parse AI result", rawOutput: subtaskResult };
          hasError = true;
        }
        const subtaskFullResult = {
          raw: { screenshotPath: `/midscene_run/${runId}/subtask-${i + 1}.png`, pageText: subtaskPageText },
          aiPrepared: parsedSubtaskResult,
          runReport: `/midscene_run/${runId}/report.html`
        };
        await addIntermediateResult(req.session.user, taskId, subtaskFullResult);
        finalResults.push(subtaskFullResult);
        await updateSubTask(req.session.user, taskId, subtask.id, { status: 'completed', progress: 100, result: subtaskFullResult });
      } catch (subtaskError) {
        console.error(`[ComplexTask] Error in subtask ${i + 1}:`, subtaskError);
        hasError = true;
        await updateSubTask(req.session.user, taskId, subtask.id, { status: 'error', progress: 100, error: subtaskError.message });
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
        "Create a comprehensive summary of the performed tasks. Return structured JSON with fields: { summary, subtasks }"
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
    task.isDone = true;
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
      task.isDone = true;
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
        if (context) await context.close();
        await browser.close();
      } catch (closeErr) {
        console.error("[ComplexTask] Error closing browser:", closeErr);
      }
      browser = null;
    }
  }
}

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

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down gracefully...');
  
  if (nliRouter) {
    await nliRouter.cleanup();
    logger.info('NLI Router closed');
  }
  
  if (quarkAgent) {
    await quarkAgent.close();
    logger.info('Quark agent closed');
  }
  
  await mongoose.connection.close();
  logger.info('Mongoose connection closed');
  
  process.exit(0);
});

// Start server
const PORT = process.env.PORT || 3400;
app.listen(PORT, () => {
  logger.info(`Server started on http://localhost:${PORT}`);
});