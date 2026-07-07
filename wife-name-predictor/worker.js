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

    if (url.pathname === "/api/portrait-transform" && request.method === "POST") {
      return handlePortraitTransform(request, env);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
};

const indianNamePattern = /^(?=.{1,80}$)[\p{L}\p{M}][\p{L}\p{M}\s.'-]*$/u;
const PORTRAIT_MODEL = "black-forest-labs/flux-kontext-pro";

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

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== "string") {
    return null;
  }

  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    return null;
  }

  return {
    mimeType: match[1],
    base64: match[2],
  };
}

function arrayBufferToDataUrl(arrayBuffer, mimeType = "image/jpeg") {
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return `data:${mimeType};base64,${btoa(binary)}`;
}

async function createReplicatePrediction(env, imageDataUrl) {
  const token = env.REPLICATE_API_TOKEN;

  if (!token) {
    throw new Error("missing_replicate_token");
  }

  const response = await fetch(
    `https://api.replicate.com/v1/models/${PORTRAIT_MODEL}/predictions`,
    {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "wait",
    },
    body: JSON.stringify({
      input: {
        image: imageDataUrl,
        prompt:
          "Transform this portrait into a realistic feminine studio portrait while preserving the same person, natural face structure, soft makeup, feminine hairstyle, photorealistic lighting, high detail. Keep the composition centered and natural.",
        output_format: "jpg",
      },
    }),
  }
  );

  if (!response.ok) {
    throw new Error(`replicate_create_failed_${response.status}`);
  }

  return response.json();
}

async function pollReplicateUntilDone(env, predictionId) {
  const token = env.REPLICATE_API_TOKEN;
  const maxAttempts = 18;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetch(
      `https://api.replicate.com/v1/predictions/${predictionId}`,
      {
        headers: {
          Authorization: `Token ${token}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`replicate_poll_failed_${response.status}`);
    }

    const prediction = await response.json();
    if (prediction.status === "succeeded") {
      return prediction;
    }

    if (prediction.status === "failed" || prediction.status === "canceled") {
      throw new Error("replicate_generation_failed");
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error("replicate_timeout");
}

function resolveReplicateOutputUrl(prediction) {
  if (!prediction || !prediction.output) {
    return null;
  }

  if (typeof prediction.output === "string") {
    return prediction.output;
  }

  if (Array.isArray(prediction.output) && typeof prediction.output[0] === "string") {
    return prediction.output[0];
  }

  return null;
}

async function downloadAsDataUrl(imageUrl) {
  const response = await fetch(imageUrl);

  if (!response.ok) {
    throw new Error("generated_image_download_failed");
  }

  const contentType = response.headers.get("Content-Type") || "image/jpeg";
  const buffer = await response.arrayBuffer();
  return arrayBufferToDataUrl(buffer, contentType);
}

async function handlePortraitTransform(request, env) {
  let body;

  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON payload" }, request, 400);
  }

  const parsedImage = parseDataUrl(body.imageDataUrl);
  if (!parsedImage) {
    return jsonResponse(
      { error: "imageDataUrl must be a base64 data URL image" },
      request,
      400
    );
  }

  try {
    let prediction = await createReplicatePrediction(env, body.imageDataUrl);

    if (prediction.status !== "succeeded") {
      prediction = await pollReplicateUntilDone(env, prediction.id);
    }

    const generatedImageUrl = resolveReplicateOutputUrl(prediction);
    if (!generatedImageUrl) {
      return jsonResponse(
        { error: "Model did not return an image output" },
        request,
        502
      );
    }

    const transformedImageDataUrl = await downloadAsDataUrl(generatedImageUrl);
    return jsonResponse({ transformedImageDataUrl }, request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "portrait_transform_failed";
    return jsonResponse({ error: message }, request, 502);
  }
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

function normalizeResultLastName(lastName) {
  if (!lastName || lastName.includes(" ")) {
    return lastName;
  }

  return lastName.charAt(0).toUpperCase() + lastName.slice(1);
}

function buildTitle(lastName) {
  const prefix = String.fromCharCode(77, 114, 115, 46);
  const normalizedLastName = normalizeResultLastName(lastName);
  return `${prefix} ${normalizedLastName}`;
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
