CREATE TABLE IF NOT EXISTS predictor_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  predicted_wife_name TEXT NOT NULL,
  advanced_enabled INTEGER NOT NULL DEFAULT 0,
  favorite_food TEXT,
  tea_coffee TEXT,
  vacation_spot TEXT,
  lucky_number TEXT,
  movie_genre TEXT,
  personality_type TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
