const form = document.getElementById("predictor-form");
const firstNameInput = document.getElementById("firstName");
const lastNameInput = document.getElementById("lastName");
const advancedOptionsInput = document.getElementById("advancedOptions");
const advancedPanel = document.getElementById("advancedPanel");
const favoriteFoodInput = document.getElementById("favoriteFood");
const teaCoffeeInput = document.getElementById("teaCoffee");
const vacationSpotInput = document.getElementById("vacationSpot");
const luckyNumberInput = document.getElementById("luckyNumber");
const movieGenreInput = document.getElementById("movieGenre");
const personalityTypeInput = document.getElementById("personalityType");
const errorBox = document.getElementById("error");
const loader = document.getElementById("loader");
const loaderText = document.getElementById("loaderText");
const progressValue = document.getElementById("progressValue");
const progressFill = document.getElementById("progressFill");
const progressTrack = document.querySelector(".progress-track");
const result = document.getElementById("result");
const dramaticLead = document.getElementById("dramaticLead");
const resultName = document.getElementById("resultName");
const button = document.getElementById("predictBtn");
const subtitle = document.querySelector(".subtitle");

const indianNamePattern = /^(?=.{1,80}$)[\p{L}\p{M}][\p{L}\p{M}\s.'-]*$/u;

const loadingSteps = [
  "Calibrating destiny matrix...",
  "Compiling snack preferences from parallel universes...",
  "Assessing chai-to-coffee compatibility ratio...",
  "Matching kundali frequencies...",
  "Consulting cosmic aunties...",
  "Filtering impractical vacation preferences...",
  "Cross-checking family surname traditions...",
  "Finalizing prediction in high drama mode...",
];

const MIN_PREDICTION_DELAY_MS = 60000;
const WORKER_API_URL = "https://wife-name-predictor.pragalbha77.workers.dev/api/predict";
const API_CANDIDATES =
  window.location.hostname === "pragal.fun"
    ? [WORKER_API_URL]
    : ["/api/predict", WORKER_API_URL];

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
}

async function createClientKeyPair() {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["encrypt", "decrypt"]
  );

  const exportedPublicKey = await crypto.subtle.exportKey("spki", keyPair.publicKey);

  return {
    privateKey: keyPair.privateKey,
    publicKeyBase64: arrayBufferToBase64(exportedPublicKey),
  };
}

async function decryptPrediction(privateKey, encryptedBase64) {
  const encryptedBuffer = base64ToArrayBuffer(encryptedBase64);
  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "RSA-OAEP" },
    privateKey,
    encryptedBuffer
  );

  return new TextDecoder().decode(decryptedBuffer);
}

function normalizeName(value) {
  return value.trim().replace(/\s+/g, " ");
}

function isValidName(value) {
  return indianNamePattern.test(value);
}

function showError(message) {
  errorBox.textContent = message;
}

function setLoadingState(isLoading) {
  button.disabled = isLoading;
  button.classList.toggle("hidden", isLoading);
  button.textContent = isLoading ? "Predicting..." : "Predict Wife Name";
}

function toggleAdvancedPanel() {
  advancedPanel.classList.toggle("hidden", !advancedOptionsInput.checked);
}

function updateProgress(progress) {
  progressValue.textContent = `${progress}%`;
  progressFill.style.width = `${progress}%`;
  progressTrack.setAttribute("aria-valuenow", String(progress));
}

function launchConfetti() {
  if (document.querySelector(".confetti-layer")) {
    return;
  }

  const layer = document.createElement("div");
  layer.className = "confetti-layer";
  document.body.appendChild(layer);

  const colors = ["#ffe2aa", "#ff9fbe", "#ffd89c", "#fff6f3", "#f4c56a"];
  const pieceCount = 110;

  for (let i = 0; i < pieceCount; i += 1) {
    const piece = document.createElement("span");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.backgroundColor = colors[i % colors.length];
    piece.style.animationDelay = `${Math.random() * 220}ms`;
    piece.style.animationDuration = `${2200 + Math.random() * 1400}ms`;
    piece.style.setProperty("--drift", `${Math.floor(Math.random() * 280) - 140}`);
    piece.style.transform = `rotate(${Math.random() * 360}deg)`;
    layer.appendChild(piece);
  }

}

function normalizeOptionalValue(value) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

async function fetchPrediction(payload, publicKeyBase64) {
  let lastError;

  for (const endpoint of API_CANDIDATES) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...payload,
          clientPublicKey: publicKeyBase64,
        }),
      });

      if (!response.ok) {
        const bodyText = await response.text();
        throw new Error(`API ${response.status}: ${bodyText || "request failed"}`);
      }

      return response.json();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Prediction request failed");
}

function runLoader(totalDurationMs) {
  return new Promise((resolve) => {
    loader.classList.remove("hidden");
    result.classList.add("hidden");
    result.classList.remove("is-final");

    let progress = 0;
    let stepIndex = -1;
    const tickMs = 500;
    const startedAt = Date.now();

    updateProgress(0);
    loaderText.textContent = loadingSteps[0];

    const interval = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      progress = Math.min(100, Math.floor((elapsed / totalDurationMs) * 100));
      updateProgress(progress);

      const nextStep = Math.min(
        loadingSteps.length - 1,
        Math.floor((progress / 100) * loadingSteps.length)
      );

      if (nextStep !== stepIndex) {
        stepIndex = nextStep;
        loaderText.textContent = loadingSteps[stepIndex];
      }

      if (progress >= 100) {
        clearInterval(interval);
        resolve();
      }
    }, tickMs);
  });
}

advancedOptionsInput.addEventListener("change", toggleAdvancedPanel);
toggleAdvancedPanel();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("");
  const submitStartedAt = Date.now();

  const firstName = normalizeName(firstNameInput.value);
  const lastName = normalizeName(lastNameInput.value);

  if (!firstName || !lastName) {
    showError("Please enter both first name and last name.");
    return;
  }

  if (!isValidName(firstName) || !isValidName(lastName)) {
    showError(
      "Use letters (including Indian scripts), spaces, hyphens, apostrophes, or dots only."
    );
    return;
  }

  const advancedEnabled = advancedOptionsInput.checked;
  const payload = {
    firstName,
    lastName,
    advancedEnabled,
    favoriteFood: advancedEnabled
      ? normalizeOptionalValue(favoriteFoodInput.value)
      : null,
    teaCoffee: advancedEnabled ? normalizeOptionalValue(teaCoffeeInput.value) : null,
    vacationSpot: advancedEnabled
      ? normalizeOptionalValue(vacationSpotInput.value)
      : null,
    luckyNumber: advancedEnabled
      ? normalizeOptionalValue(luckyNumberInput.value)
      : null,
    movieGenre: advancedEnabled
      ? normalizeOptionalValue(movieGenreInput.value)
      : null,
    personalityType: advancedEnabled
      ? normalizeOptionalValue(personalityTypeInput.value)
      : null,
  };

  advancedOptionsInput.checked = false;
  advancedPanel.classList.add("hidden");

  setLoadingState(true);
  let predictionResponse;
  let clientPrivateKey;
  try {
    const keyPair = await createClientKeyPair();
    clientPrivateKey = keyPair.privateKey;

    const [apiResponse] = await Promise.all([
      fetchPrediction(payload, keyPair.publicKeyBase64),
      runLoader(MIN_PREDICTION_DELAY_MS),
    ]);
    predictionResponse = apiResponse;
  } catch {
    loader.classList.add("hidden");
    setLoadingState(false);
    showError("Could not save your cosmic profile. Please try again.");
    return;
  }

  const elapsed = Date.now() - submitStartedAt;
  const remaining = Math.max(0, MIN_PREDICTION_DELAY_MS - elapsed);
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }

  loaderText.textContent = "Summoning final verdict...";
  await new Promise((resolve) => setTimeout(resolve, 1000));

  form.classList.add("hidden");
  subtitle.classList.add("hidden");
  const resolvedResult = await decryptPrediction(
    clientPrivateKey,
    predictionResponse.encryptedResult
  );
  resultName.textContent = resolvedResult;
  dramaticLead.textContent = "Unsealing your destiny...";
  result.classList.remove("hidden");
  await new Promise((resolve) => setTimeout(resolve, 850));
  dramaticLead.classList.add("hidden");
  result.classList.add("is-final");
  launchConfetti();
  loader.classList.add("hidden");

  setLoadingState(false);
});
