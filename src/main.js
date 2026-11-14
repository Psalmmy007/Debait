
import './style.css';
import { app } from './firebase.js';

import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend
} from 'firebase/ai';

// Connect to Gemini through Firebase AI Logic
const ai = getAI(app, {
  backend: new GoogleAIBackend()
});

// Create our AI model
const model = getGenerativeModel(ai, {
  model: 'gemini-3.5-flash-lite'
});

// Create the Debait webpage
document.querySelector('#app').innerHTML = `
  <div class="debait-container">
    <h1>🧠 Debait</h1>
    <h2>Nutrition Facts for Your Feed</h2>

    <p>
      Discover the emotional framing behind
      the headlines you read.
    </p>

    <div class="analyzer">
      <h3>Analyze a Headline</h3>

      <textarea
        id="headline"
        rows="4"
        placeholder="Paste a headline here..."
      ></textarea>

      <button id="analyzeBtn">
        Analyze Headline
      </button>

      <h3>Analysis Result</h3>
      <div id="result"></div>
    </div>

    <p id="firebase-status"></p>
  </div>
`;

document.querySelector('#firebase-status').textContent =
  `Firebase project: ${app.options.projectId}`;

// Run when someone clicks Analyze Headline
document.querySelector('#analyzeBtn').addEventListener(
  'click',
  async () => {
    const headline = document
      .querySelector('#headline')
      .value.trim();

    const resultBox = document.querySelector('#result');
    const button = document.querySelector('#analyzeBtn');

    if (!headline) {
      resultBox.textContent = 'Please enter a headline.';
      return;
    }

    button.disabled = true;
    button.textContent = 'Analyzing...';
    resultBox.textContent = 'Debait is examining this headline...';

    const prompt = `
You are Debait, an AI headline analysis assistant.

Analyze the following headline:

"${headline}"

Provide these sections:

1. EMOTIONAL FRAMING:
Identify the emotion the headline may evoke.

2. MANIPULATION TECHNIQUES:
Identify possible clickbait, sensationalism,
curiosity gaps, fear appeals, or outrage framing.

3. EXPLANATION:
Explain the specific words that influenced
your classification.

4. NEUTRAL REWRITE:
Rewrite the headline in calmer language
without inventing facts or changing its meaning.
If there is insufficient information, say so.

5. FACTUAL ACCURACY:
Explain that headline wording alone cannot
establish whether the underlying claims are true.

Important:
Negative news is not automatically manipulative.
Do not assume a claim is false merely because
the headline uses emotional language.
`;

    try {
      const response = await model.generateContent(prompt);

      resultBox.textContent =
        response.response.text() || 'No analysis returned.';

    } catch (error) {
      console.error('Debait AI error:', error);

      resultBox.textContent =
        'AI request failed: ' + error.message;
    } finally {
      button.disabled = false;
      button.textContent = 'Analyze Headline';
    }
  }
);
