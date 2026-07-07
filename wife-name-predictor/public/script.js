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

  setTimeout(() => {
    layer.remove();
  }, 4200);
}

function normalizeOptionalValue(value) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

async function fetchPrediction(payload) {
  const response = await fetch("/api/predict", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error("Failed to store submission");
  }

  return response.json();
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

  setLoadingState(true);
  let predictionResponse;
  try {
    const [apiResponse] = await Promise.all([
      fetchPrediction(payload),
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

  resultName.textContent = predictionResponse.result;
  dramaticLead.textContent = "Unsealing your destiny...";
  result.classList.remove("hidden");
  await new Promise((resolve) => setTimeout(resolve, 850));
  dramaticLead.classList.add("hidden");
  form.classList.add("hidden");
  result.classList.add("is-final");
  launchConfetti();
  loader.classList.add("hidden");

  setLoadingState(false);
});
