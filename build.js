const fs = require("fs");
const path = require("path");

const root = __dirname;
const dist = path.join(root, "dist");
const staticFiles = ["index.html", "styles.css", "app.js"];

function readLocalConfig() {
  const configPath = path.join(root, "config.js");
  if (!fs.existsSync(configPath)) return {};

  const source = fs.readFileSync(configPath, "utf8");
  return {
    SUPABASE_URL: source.match(/SUPABASE_URL:\s*"([^"]+)"/)?.[1],
    SUPABASE_ANON_KEY: source.match(/SUPABASE_ANON_KEY:\s*"([^"]+)"/)?.[1]
  };
}

function requireConfigValue(name, value) {
  if (!value || value.includes("your-project") || value.includes("your-public")) {
    throw new Error(
      `${name} is missing. Set ${name} in Vercel Environment Variables or update local config.js before building.`
    );
  }
  return value;
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

for (const file of staticFiles) {
  fs.copyFileSync(path.join(root, file), path.join(dist, file));
}

const localConfig = readLocalConfig();
const supabaseUrl = requireConfigValue("SUPABASE_URL", process.env.SUPABASE_URL || localConfig.SUPABASE_URL);
const supabaseAnonKey = requireConfigValue(
  "SUPABASE_ANON_KEY",
  process.env.SUPABASE_ANON_KEY || localConfig.SUPABASE_ANON_KEY
);

const configSource = `window.SECURE_FINANCIAL_CONFIG = {
  SUPABASE_URL: ${JSON.stringify(supabaseUrl)},
  SUPABASE_ANON_KEY: ${JSON.stringify(supabaseAnonKey)}
};
`;

fs.writeFileSync(path.join(dist, "config.js"), configSource);
console.log("Built Secure Financial into dist.");
