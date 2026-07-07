export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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
    return Response.json(
      { error: "Database binding is missing" },
      { status: 500 }
    );
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const firstName = sanitizeOptionalText(body.firstName, 80);
  const lastName = sanitizeOptionalText(body.lastName, 80);

  if (!isValidName(firstName) || !isValidName(lastName)) {
    return Response.json(
      { error: "firstName and lastName must be valid names" },
      { status: 400 }
    );
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

  return Response.json({ result: resolvedTitle });
}
