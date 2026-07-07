export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(request),
      });
    }

    if (url.pathname === "/api/predict" && request.method === "POST") {
      return handlePrediction(request, env);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
};

const indianNamePattern = /^(?=.{1,80}$)[\p{L}\p{M}][\p{L}\p{M}\s.'-]*$/u;

function getCorsHeaders(request) {
  const origin = request.headers.get("Origin") || "*";

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function jsonResponse(payload, request, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...getCorsHeaders(request),
    },
  });
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function uint8ArrayToBase64(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

async function encryptForClient(clientPublicKeyBase64, plainText) {
  const publicKeyBytes = base64ToUint8Array(clientPublicKeyBase64);
  const publicKey = await crypto.subtle.importKey(
    "spki",
    publicKeyBytes,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    false,
    ["encrypt"]
  );

  const encrypted = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    publicKey,
    new TextEncoder().encode(plainText)
  );

  return uint8ArrayToBase64(new Uint8Array(encrypted));
}

function sanitizeOptionalText(value, maxLength = 120) {
  if (typeof value !== "string") {
    return null;
  }

  const sanitized = value.trim().replace(/\s+/g, " ");
  if (!sanitized) {
    return null;
  }

  return sanitized.slice(0, maxLength);
}

function isValidName(value) {
  return typeof value === "string" && indianNamePattern.test(value);
}

function buildTitle(lastName) {
  const prefix = String.fromCharCode(77, 114, 115, 46);
  return `${prefix} ${lastName}`;
}

async function insertRecord(env, fields) {
  const preferredStatement = env.DB.prepare(
    `INSERT INTO predictor_submissions (
      first_name,
      last_name,
      predicted_label,
      advanced_enabled,
      favorite_food,
      tea_coffee,
      vacation_spot,
      lucky_number,
      movie_genre,
      personality_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  try {
    await preferredStatement
      .bind(...fields)
      .run();
    return;
  } catch {
    const fallbackStatement = env.DB.prepare(
      `INSERT INTO predictor_submissions (
        first_name,
        last_name,
        predicted_wife_name,
        advanced_enabled,
        favorite_food,
        tea_coffee,
        vacation_spot,
        lucky_number,
        movie_genre,
        personality_type
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    await fallbackStatement
      .bind(...fields)
      .run();
  }
}

async function handlePrediction(request, env) {
  if (!env.DB) {
    return jsonResponse(
      { error: "Database binding is missing" },
      request,
      500
    );
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON payload" }, request, 400);
  }

  const firstName = sanitizeOptionalText(body.firstName, 80);
  const lastName = sanitizeOptionalText(body.lastName, 80);
  const clientPublicKey = sanitizeOptionalText(body.clientPublicKey, 4096);

  if (!isValidName(firstName) || !isValidName(lastName)) {
    return jsonResponse(
      { error: "firstName and lastName must be valid names" },
      request,
      400
    );
  }

  if (!clientPublicKey) {
    return jsonResponse({ error: "clientPublicKey is required" }, request, 400);
  }

  const advancedEnabled = Boolean(body.advancedEnabled);
  const favoriteFood = advancedEnabled
    ? sanitizeOptionalText(body.favoriteFood)
    : null;
  const teaCoffee = advancedEnabled ? sanitizeOptionalText(body.teaCoffee) : null;
  const vacationSpot = advancedEnabled
    ? sanitizeOptionalText(body.vacationSpot)
    : null;
  const luckyNumber = advancedEnabled
    ? sanitizeOptionalText(body.luckyNumber, 20)
    : null;
  const movieGenre = advancedEnabled
    ? sanitizeOptionalText(body.movieGenre)
    : null;
  const personalityType = advancedEnabled
    ? sanitizeOptionalText(body.personalityType, 40)
    : null;

  const resolvedTitle = buildTitle(lastName);

  await insertRecord(env, [
      firstName,
      lastName,
      resolvedTitle,
      advancedEnabled ? 1 : 0,
      favoriteFood,
      teaCoffee,
      vacationSpot,
      luckyNumber,
      movieGenre,
      personalityType
    ]);

  let encryptedResult;

  try {
    encryptedResult = await encryptForClient(clientPublicKey, resolvedTitle);
  } catch {
    return jsonResponse({ error: "Failed to encrypt result" }, request, 400);
  }

  return jsonResponse({ encryptedResult }, request);
}
