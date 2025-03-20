
const { PuppeteerAgent } = require('@midscene/web/puppeteer');
const puppeteer = require('puppeteer');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIDSCENE_RUN_DIR = path.join(__dirname, 'midscene_run');
if (!fs.existsSync(MIDSCENE_RUN_DIR)) { fs.mkdirSync(MIDSCENE_RUN_DIR, { recursive: true }); }
module.exports = async function automateComplexTask(userId, taskId, url, command) {
  const User = mongoose.model('User');
  let browser;
  try {
    const user = await User.findById(userId);
    const task = user.activeTasks.find(t => t._id.toString() === taskId.toString());
    if (!task || !task.isComplex || !task.subTasks || task.subTasks.length === 0) {
      throw new Error("Task not found or not properly configured as complex");
    }
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
    for (let i = 0; i < task.subTasks.length; i++) {
      const subtask = task.subTasks[i];
      console.log(`[ComplexTask] Processing subtask ${i+1}/${task.subTasks.length}: ${subtask.command}`);
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
           //throw actionError;
            continue;
          }
        }
        await sleep(2000);
        const subtaskScreenshot = await page.screenshot({ encoding: 'base64' });
        const subtaskPageText = await page.evaluate(() => document.body.innerText);
        const screenshotPath = path.join(runDir, `subtask-${i+1}.png`);
        fs.writeFileSync(screenshotPath, Buffer.from(subtaskScreenshot, 'base64'));
        const subtaskResult = await agent.aiQuery("Describe what you just accomplished in this step in a human-readable format. Provide a summary and any relevant data extracted. Format as JSON with fields: {step, success, summary, data}");
        let parsedResult;
        try {
          parsedResult = typeof subtaskResult === 'string' ? JSON.parse(subtaskResult) : subtaskResult;
        } catch (parseError) {
          parsedResult = { step: `Subtask ${i+1}`, success: false, summary: "Failed to parse AI result", rawOutput: subtaskResult };
        }
        const subtaskFullResult = {
          raw: { screenshotPath: `/midscene_run/${runId}/subtask-${i+1}.png`, pageText: subtaskPageText },
          aiPrepared: parsedResult,
          runReport: `/midscene_run/report/${agent.reportFileName}.html`
        };
        task.intermediateResults.push(subtaskFullResult);
        finalResults.push(subtaskFullResult);
        subtask.status = 'completed';
        subtask.progress = 100;
        subtask.result = subtaskFullResult;
        await user.save();
      } catch (subtaskError) {
        console.error(`[ComplexTask] Error in subtask ${i+1}:`, subtaskError);
        subtask.status = 'error';
        subtask.progress = 100;
        subtask.error = subtaskError.message;
        await user.save();
        //break;
        continue;
      }
    }
    const finalSummary = await agent.aiQuery("Create a comprehensive summary of all the tasks performed and the results in a human-readable format. Return structured JSON with fields: { summary, subtasks }");
    let parsedSummary;
    try {
      parsedSummary = typeof finalSummary === 'string' ? JSON.parse(finalSummary) : finalSummary;
    } catch (parseError) {
      parsedSummary = { summary: "Failed to parse final summary", rawOutput: finalSummary };
    }
    const reportFileBaseName = agent.reportFileName;
    const finalResult = {
      raw: finalResults.map(subtask => subtask.raw),
      aiPrepared: { subtasks: finalResults.map(subtask => subtask.aiPrepared), summary: parsedSummary },
      runReport: `/midscene_run/report/${reportFileBaseName}.html`
    };
    await browser.close();
    browser = null;
    task.status = 'completed';
    task.progress = 100;
    task.endTime = new Date();
    await user.save();
    user.history.push({ url, command, result: finalResult, timestamp: new Date() });
    const taskIndex = user.activeTasks.findIndex(t => t._id.toString() === taskId.toString());
    if (taskIndex !== -1) { user.activeTasks.splice(taskIndex, 1); }
    await user.save();
    return finalResult;
  } catch (err) {
    console.error("[ComplexTask] Error:", err);
    const user = await User.findById(req.session.user);
    const task = user.activeTasks.find(t => t._id.toString() === taskId.toString());
    if (task) {
      task.status = 'error';
      task.progress = 100;
      task.error = err.message || "Unknown error";
      task.endTime = new Date();
      await user.save();
    }
    if (browser) {
      try { await browser.close(); } catch (closeErr) { console.error("[ComplexTask] Error closing browser:", closeErr); }
    }
    throw err;
  }
};
