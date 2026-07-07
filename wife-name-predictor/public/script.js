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
const wifeName = document.getElementById("wifeName");
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

function predictWifeName(lastName) {
  return `Mrs. ${lastName}`;
}

function normalizeOptionalValue(value) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

async function saveSubmission(payload) {
  const response = await fetch("/api/submissions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error("Failed to store submission");
  }
}

function runLoader() {
  return new Promise((resolve) => {
    loader.classList.remove("hidden");
    result.classList.add("hidden");
    result.classList.remove("is-final");

    let progress = 0;
    let stepIndex = 0;

    updateProgress(0);
    loaderText.textContent = loadingSteps[0];

    const interval = setInterval(() => {
      const increment = Math.floor(Math.random() * 5) + 2;
      progress = Math.min(100, progress + increment);
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
        setTimeout(resolve, 1800);
      }
    }, 880);
  });
}

advancedOptionsInput.addEventListener("change", toggleAdvancedPanel);
toggleAdvancedPanel();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("");

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
  try {
    await Promise.all([runLoader(), saveSubmission(payload)]);
  } catch {
    loader.classList.add("hidden");
    setLoadingState(false);
    showError("Could not save your cosmic profile. Please try again.");
    return;
  }

  loaderText.textContent = "Summoning final verdict...";
  await new Promise((resolve) => setTimeout(resolve, 1000));

  wifeName.textContent = predictWifeName(lastName);
  dramaticLead.textContent = "Unsealing your destiny...";
  result.classList.remove("hidden");
  await new Promise((resolve) => setTimeout(resolve, 850));
  dramaticLead.textContent = "Prediction confirmed by cosmic committee.";
  result.classList.add("is-final");
  loader.classList.add("hidden");

  setLoadingState(false);
});
