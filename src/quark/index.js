import { QuarkCore, VisionModule, AutomationModule, NLPModule } from '@open-cuak/core';
import { keyboard, Key, mouse, screen, Button, Point } from '@nut-tree-fork/nut-js';
import { VisionProcessor } from '@open-cuak/vision';
import { AutomationEngine } from '@open-cuak/automation';
import { NLPProcessor } from '@open-cuak/nlp';

class QuarkAgent {
  constructor() {
    this.core = new QuarkCore({
      vision: new VisionModule(),
      automation: new AutomationModule(),
      nlp: new NLPModule()
    });

    this.visionProcessor = new VisionProcessor();
    this.automationEngine = new AutomationEngine();
    this.nlpProcessor = new NLPProcessor();
    // Configure mouse movement settings
    mouse.config.mouseSpeed = 1000; // Pixels per second
    mouse.config.autoDelayMs = 100;
  }

  async initialize() {
    await this.core.initialize();
    await this.visionProcessor.initialize();
    await this.automationEngine.initialize();
    await this.nlpProcessor.initialize();
  }

  async processCommand(command, options = {}) {
    // Analyze if command requires desktop automation
    const nlpResult = await this.nlpProcessor.analyze(command);
    const requiresDesktop = nlpResult.intents.some(intent => 
      ['launchApp', 'systemCommand', 'keyPress', 'mouseAction'].includes(intent)
    );

    if (requiresDesktop) {
      return await this.handleDesktopCommand(nlpResult, options);
    }
    
    // Extract visual elements if needed
    if (options.screenshot) {
      const visionResult = await this.visionProcessor.analyze(options.screenshot);
      nlpResult.visualContext = visionResult;
    }

    // Generate automation plan
    const automationPlan = await this.automationEngine.planActions(nlpResult);

    // Execute automation steps
    const result = await this.automationEngine.execute(automationPlan);

    return {
      nlpAnalysis: nlpResult,
      automationPlan,
      executionResult: result
    };
  }

  async captureScreen() {
    return await this.visionProcessor.captureScreen();
  }

  async findElement(selector, options = {}) {
    const screenshot = await this.captureScreen();
    const visionResult = await this.visionProcessor.analyze(screenshot);
    return await this.visionProcessor.findElement(visionResult, selector, options);
  }

  async click(selector) {
    const element = await this.findElement(selector);
    await this.automationEngine.click(element);
  }

  async type(text, selector) {
    const element = await this.findElement(selector);
    await this.automationEngine.type(element, text);
  }

  async scroll(direction, amount) {
    await this.automationEngine.scroll(direction, amount);
  }

  // Enhanced drag and drop with path support
  async dragAndDrop(startX, startY, endX, endY, options = {}) {
    const {
      speed = 1000,
      path = 'direct',
      holdDelay = 500,
      releaseDelay = 200
    } = options;

    mouse.config.mouseSpeed = speed;

    await mouse.setPosition(new Point(startX, startY));
    await mouse.pressButton(Button.LEFT);
    await new Promise(r => setTimeout(r, holdDelay));

    if (path === 'direct') {
      await mouse.setPosition(new Point(endX, endY));
    } else if (path === 'curved') {
      // Create a curved path using control points
      const controlX = (startX + endX) / 2;
      const controlY = Math.min(startY, endY) - 100;
      await this.followCurvedPath(startX, startY, controlX, controlY, endX, endY);
    } else if (Array.isArray(path)) {
      // Follow custom path points
      for (const point of path) {
        await mouse.setPosition(new Point(point.x, point.y));
        await new Promise(r => setTimeout(r, 50));
      }
    }

    await new Promise(r => setTimeout(r, releaseDelay));
    await mouse.releaseButton(Button.LEFT);
  }

  // Multi-item drag and drop
  async dragAndDropMultiple(items, options = {}) {
    const {
      groupDelay = 500,
      useCtrl = true
    } = options;

    if (useCtrl) {
      await keyboard.pressKey(Key.LeftControl);
    }

    // Select all items first
    for (const item of items) {
      await mouse.setPosition(new Point(item.x, item.y));
      await mouse.leftClick();
      await new Promise(r => setTimeout(r, 100));
    }

    if (useCtrl) {
      await keyboard.releaseKey(Key.LeftControl);
    }

    await new Promise(r => setTimeout(r, groupDelay));

    // Perform the drag and drop
    await this.dragAndDrop(
      items[0].x,
      items[0].y,
      options.targetX,
      options.targetY,
      options
    );
  }

  async waitForElement(selector, timeout = 5000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const element = await this.findElement(selector, { required: false });
      if (element) return element;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Element ${selector} not found within ${timeout}ms`);
  }

  async close() {
    await this.core.cleanup();
    await this.visionProcessor.cleanup();
    await this.automationEngine.cleanup();
  }

  // Desktop Automation - Computer Operations
  async handleDesktopCommand(nlpResult, options = {}) {
    const { intent, parameters } = nlpResult;

    switch (intent) {
      case 'launchApp':
        await this.launchApplication(parameters.appName);
        break;
      case 'keyPress':
        await keyboard.pressKey(parameters.key);
        await keyboard.releaseKey(parameters.key);
        break;
      case 'typeText':
        await keyboard.type(parameters.text);
        break;
      case 'mouseAction':
        switch (parameters.action) {
          case 'click':
            await mouse.leftClick();
            break;
          case 'rightClick':
            await mouse.rightClick();
            break;
          case 'doubleClick':
            await mouse.doubleClick();
            break;
          case 'move':
            await mouse.setPosition(parameters.x, parameters.y);
            break;
        }
        break;
    }

    // Capture result
    const screenshot = await screen.capture();
    return {
      success: true,
      screenshot,
      action: intent,
      parameters
    };
  }

  async launchApplication(appName) {
    if (process.platform === 'win32') {
      await keyboard.pressKey(Key.LeftSuper);
      await keyboard.type(appName);
      await keyboard.pressKey(Key.Enter);
      await keyboard.releaseKey(Key.Enter);
      await keyboard.releaseKey(Key.LeftSuper);
    } else if (process.platform === 'darwin') {
      await keyboard.pressKey(Key.LeftSuper);
      await keyboard.pressKey(Key.Space);
      await keyboard.releaseKey(Key.Space);
      await keyboard.releaseKey(Key.LeftSuper);
      await keyboard.type(appName);
      await keyboard.pressKey(Key.Enter);
      await keyboard.releaseKey(Key.Enter);
    }
  }

  // Window management
  async getActiveWindow() {
    return await this.automationEngine.getActiveWindow();
  }

  async setWindowBounds(bounds) {
    const window = await this.getActiveWindow();
    await window.setBounds(bounds);
  }

  async maximizeWindow() {
    const window = await this.getActiveWindow();
    await window.maximize();
  }

  async minimizeWindow() {
    const window = await this.getActiveWindow();
    await window.minimize();
  }

  // Multi-monitor support
  async getScreens() {
    return await screen.all();
  }

  async moveToScreen(windowId, screenNumber) {
    const screens = await this.getScreens();
    if (screenNumber >= screens.length) {
      throw new Error('Invalid screen number');
    }
    
    const targetScreen = screens[screenNumber];
    const window = await this.automationEngine.getWindow(windowId);
    await window.setBounds({
      x: targetScreen.bounds.x,
      y: targetScreen.bounds.y,
      width: window.bounds.width,
      height: window.bounds.height
    });
  }

  // Screen region capture
  async captureRegion(x, y, width, height) {
    return await screen.captureRegion(new Point(x, y), width, height);
  }

  // Color detection
  async getColorAt(x, y) {
    const screenshot = await this.captureRegion(x, y, 1, 1);
    return await this.visionProcessor.getPixelColor(screenshot, 0, 0);
  }

  // System clipboard
  async getClipboard() {
    return await this.automationEngine.getClipboardContent();
  }

  async setClipboard(content) {
    await this.automationEngine.setClipboardContent(content);
  }

  // Keyboard shortcuts
  async sendShortcut(keys) {
    for (const key of keys) {
      await keyboard.pressKey(key);
    }
    for (const key of keys.reverse()) {
      await keyboard.releaseKey(key);
    }
  }

  // Helper method for curved paths
  async followCurvedPath(startX, startY, controlX, controlY, endX, endY) {
    const steps = 20;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = Math.pow(1 - t, 2) * startX + 
                2 * (1 - t) * t * controlX + 
                Math.pow(t, 2) * endX;
      const y = Math.pow(1 - t, 2) * startY + 
                2 * (1 - t) * t * controlY + 
                Math.pow(t, 2) * endY;
      await mouse.setPosition(new Point(Math.round(x), Math.round(y)));
      await new Promise(r => setTimeout(r, 25));
    }
  }
}

module.exports = QuarkAgent;