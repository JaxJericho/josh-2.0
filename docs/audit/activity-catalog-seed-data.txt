/**
 * Activity Catalog Seed Data — JOSH 3.0
 *
 * This file is the authoritative seed source for the `activity_catalog` table.
 * Run via: `npx ts-node scripts/seed-activity-catalog.ts` or equivalent.
 *
 * Structure matches the ActivityCatalogEntry type and the activity_pattern object
 * used in profile signal extraction. See:
 *   - Profile Interview And Signal Extraction Spec
 *   - Compatibility Scoring And Matching Algorithm (JOSH 3.0)
 *
 * ─── CATEGORIES ────────────────────────────────────────────────────────────────
 * Categories are organized by energy and experience type, not venue type.
 *
 *   high_energy_physical     — physical, active, body-forward experiences
 *   competitive_games        — games with stakes, scores, or rules
 *   spectating_live_events   — watching, witnessing, being in the crowd
 *   food_drink_texture       — food and drink with personality and setting
 *   creative_making          — making things with hands, cameras, instruments
 *   ambient_low_key          — slow-paced, low-stakes, undirected time
 *   wellness_body            — restoration, movement with intention, body care
 *   night_social             — nightlife, dancing, late-format social
 *   seasonal_occasional      — tied to time of year, weather, or special events
 *
 * ─── REGIONAL AVAILABILITY ─────────────────────────────────────────────────────
 * Each entry includes a regional_availability tag used by the suggestion engine
 * to avoid surfacing activities that don't exist in a given market.
 *
 *   anywhere       — works in any market (trivia, hiking, coffee, board games)
 *   suburban       — common in suburbs and mid-density markets (bowling, mini golf)
 *   urban_mid      — requires a mid-size or larger city (escape rooms, yoga studios)
 *   urban_dense    — requires a major metro (speakeasies, izakayas, bachata nights,
 *                    drag shows, aerial silks, esports venues)
 *
 * ─── MOTIVE KEYS ────────────────────────────────────────────────────────────────
 * From the Motives Dictionary:
 *   restorative | connection | play | exploration | achievement
 *   stimulation | belonging | focus | comfort
 *
 * All motive_weights values are 0.0–1.0. They represent how strongly this activity
 * tends to fulfill each motive for most participants. Learning overlays per user
 * will drift these over time.
 */

export type MotiveWeights = {
  restorative: number;
  connection: number;
  play: number;
  exploration: number;
  achievement: number;
  stimulation: number;
  belonging: number;
  focus: number;
  comfort: number;
};

export type ActivityConstraints = {
  setting: "indoor" | "outdoor" | "either";
  noise_level: "quiet" | "moderate" | "loud";
  physical_demand: "low" | "medium" | "high";
  requires_booking: boolean;
  weather_dependent: boolean;
};

export type RegionalAvailability = "anywhere" | "suburban" | "urban_mid" | "urban_dense";

export type ActivityCatalogEntry = {
  activity_key: string;
  display_name: string;
  category: string;
  short_description: string; // Used by JOSH in suggestions. Keep under 12 words.
  regional_availability: RegionalAvailability;
  motive_weights: MotiveWeights;
  constraints: ActivityConstraints;
  preferred_windows: Array<"morning" | "afternoon" | "evening" | "weekend">;
  group_size_fit: Array<"solo" | "small" | "medium" | "large">;
  tags: string[]; // Freeform tags for LLM context. Not used in scoring.
};

export const ACTIVITY_CATALOG: ActivityCatalogEntry[] = [

  // ─────────────────────────────────────────────
  // HIGH ENERGY / PHYSICAL
  // ─────────────────────────────────────────────

  {
    activity_key: "rock_climbing_gym",
    display_name: "Climbing gym",
    category: "high_energy_physical",
    short_description: "Bouldering or top-rope — good conversation between routes.",
    regional_availability: "urban_mid",
    motive_weights: {
      restorative: 0.1, connection: 0.5, play: 0.6, exploration: 0.3,
      achievement: 0.8, stimulation: 0.7, belonging: 0.5, focus: 0.7, comfort: 0.1,
    },
    constraints: { setting: "indoor", noise_level: "moderate", physical_demand: "high", requires_booking: false, weather_dependent: false },
    preferred_windows: ["afternoon", "evening"],
    group_size_fit: ["small"],
    tags: ["active", "challenge", "skill", "physical"],
  },

  {
    activity_key: "paintball",
    display_name: "Paintball",
    category: "high_energy_physical",
    short_description: "Loud, chaotic, and a great equalizer for a new group.",
    regional_availability: "suburban",
    motive_weights: {
      restorative: 0.0, connection: 0.5, play: 0.9, exploration: 0.1,
      achievement: 0.6, stimulation: 0.9, belonging: 0.7, focus: 0.5, comfort: 0.0,
    },
    constraints: { setting: "outdoor", noise_level: "loud", physical_demand: "high", requires_booking: true, weather_dependent: false },
    preferred_windows: ["afternoon", "weekend"],
    group_size_fit: ["medium", "large"],
    tags: ["competitive", "physical", "adrenaline", "group-bonding"],
  },

  {
    activity_key: "go_karts",
    display_name: "Go-karts",
    category: "high_energy_physical",
    short_description: "Fast, dumb, and immediately fun for anyone.",
    regional_availability: "suburban",
    motive_weights: {
      restorative: 0.0, connection: 0.5, play: 0.9, exploration: 0.1,
      achievement: 0.6, stimulation: 0.9, belonging: 0.6, focus: 0.4, comfort: 0.1,
    },
    constraints: { setting: "either", noise_level: "loud", physical_demand: "low", requires_booking: false, weather_dependent: false },
    preferred_windows: ["afternoon", "evening", "weekend"],
    group_size_fit: ["small", "medium"],
    tags: ["competitive", "adrenaline", "playful", "low-bar"],
  },

  {
    activity_key: "bike_ride",
    display_name: "Bike ride",
    category: "high_energy_physical",
    short_description: "A good route, no destination pressure — just riding.",
    regional_availability: "anywhere",
    motive_weights: {
      restorative: 0.5, connection: 0.5, play: 0.4, exploration: 0.7,
      achievement: 0.3, stimulation: 0.5, belonging: 0.3, focus: 0.3, comfort: 0.4,
    },
    constraints: { setting: "outdoor", noise_level: "moderate", physical_demand: "medium", requires_booking: false, weather_dependent: true },
    preferred_windows: ["morning", "afternoon", "weekend"],
    group_size_fit: ["small"],
    tags: ["active", "outdoor", "exploration", "casual"],
  },

  {
    activity_key: "hike",
    display_name: "Hike",
    category: "high_energy_physical",
    short_description: "Get out of the city on a trail with a payoff at the end.",
    regional_availability: "anywhere",
    motive_weights: {
      restorative: 0.7, connection: 0.6, play: 0.2, exploration: 0.7,
      achievement: 0.5, stimulation: 0.4, belonging: 0.4, focus: 0.4, comfort: 0.3,
    },
    constraints: { setting: "outdoor", noise_level: "quiet", physical_demand: "medium", requires_booking: false, weather_dependent: true },
    preferred_windows: ["morning", "weekend"],
    group_size_fit: ["small", "medium"],
    tags: ["nature", "physical", "conversation", "escape"],
  },

  {
    activity_key: "tennis_pickleball",
    display_name: "Tennis or pickleball",
    category: "high_energy_physical",
    short_description: "Rally-focused — no scorekeeping required.",
    regional_availability: "anywhere",
    motive_weights: {
      restorative: 0.2, connection: 0.6, play: 0.8, exploration: 0.1,
      achievement: 0.4, stimulation: 0.7, belonging: 0.5, focus: 0.5, comfort: 0.2,
    },
    constraints: { setting: "outdoor", noise_level: "moderate", physical_demand: "medium", requires_booking: true, weather_dependent: true },
    preferred_windows: ["morning", "afternoon", "weekend"],
    group_size_fit: ["small"],
    tags: ["sport", "active", "playful", "recurring"],
  },

  {
    activity_key: "pickup_sport",
    display_name: "Pickup sport",
    category: "high_energy_physical",
    short_description: "Flag football, volleyball, basketball — casual team format.",
    regional_availability: "anywhere",
    motive_weights: {
      restorative: 0.1, connection: 0.6, play: 0.8, exploration: 0.1,
      achievement: 0.5, stimulation: 0.8, belonging: 0.8, focus: 0.4, comfort: 0.2,
    },
    constraints: { setting: "outdoor", noise_level: "moderate", physical_demand: "high", requires_booking: false, weather_dependent: true },
    preferred_windows: ["morning", "afternoon", "weekend"],
    group_size_fit: ["medium", "large"],
    tags: ["team", "sport", "active", "community"],
  },

  {
    activity_key: "paddleboarding",
    display_name: "Paddleboarding or kayaking",
    category: "high_energy_physical",
    short_description: "On the water — easy to be bad at together.",
    regional_availability: "urban_mid",
    motive_weights: {
      restorative: 0.5, connection: 0.5, play: 0.5, exploration: 0.5,
      achievement: 0.3, stimulation: 0.5, belonging: 0.3, focus: 0.4, comfort: 0.3,
    },
    constraints: { setting: "outdoor", noise_level: "moderate", physical_demand: "medium", requires_booking: true, weather_dependent: true },
    preferred_windows: ["morning", "afternoon", "weekend"],
    group_size_fit: ["small"],
    tags: ["water", "active", "outdoor", "seasonal"],
  },

  // ─────────────────────────────────────────────
  // COMPETITIVE & GAMES
  // ─────────────────────────────────────────────

  {
    activity_key: "trivia_night",
    display_name: "Pub trivia night",
    category: "competitive_games",
    short_description: "A recurring event where you find out who knows weird things.",
    regional_availability: "anywhere",
    motive_weights: {
      restorative: 0.2, connection: 0.6, play: 0.7, exploration: 0.3,
      achievement: 0.5, stimulation: 0.7, belonging: 0.8, focus: 0.5, comfort: 0.5,
    },
    constraints: { setting: "indoor", noise_level: "loud", physical_demand: "low", requires_booking: false, weather_dependent: false },
    preferred_windows: ["evening"],
    group_size_fit: ["small", "medium"],
    tags: ["games", "social", "recurring", "competitive"],
  },

  {
    activity_key: "escape_room",
    display_name: "Escape room",
    category: "competitive_games",
    short_description: "Solve a room together — fast track to knowing how someone thinks.",
    regional_availability: "urban_mid",
    motive_weights: {
      restorative: 0.0, connection: 0.7, play: 0.7, exploration: 0.4,
      achievement: 0.8, stimulation: 0.8, belonging: 0.6, focus: 0.8, comfort: 0.1,
    },
    constraints: { setting: "indoor", noise_level: "moderate", physical_demand: "low", requires_booking: true, weather_dependent: false },
    preferred_windows: ["afternoon", "evening", "weekend"],
    group_size_fit: ["small", "medium"],
    tags: ["games", "challenge", "bonding", "problem-solving"],
  },

  {
    activity_key: "board_game_cafe",
    display_name: "Board game café",
    category: "competitive_games",
    short_description: "A library of games, drinks, and no timeline.",
    regional_availability: "urban_mid",
    motive_weights: {
      restorative: 0.3, connection: 0.6, play: 0.9, exploration: 0.3,
      achievement: 0.4, stimulation: 0.6, belonging: 0.7, focus: 0.5, comfort: 0.7,
    },
    constraints: { setting: "indoor", noise_level: "moderate", physical_demand: "low", requires_booking: false, weather_dependent: false },
    preferred_windows: ["afternoon", "evening", "weekend"],
    group_size_fit: ["small", "medium"],
    tags: ["games", "casual", "social", "low-stakes"],
  },

  {
    activity_key: "bowling",
    display_name: "Bowling",
    category: "competitive_games",
    short_description: "Low-skill floor, high fun ceiling — hard to have a bad time.",
    regional_availability: "suburban",
    motive_weights: {
      restorative: 0.2, connection: 0.6, play: 0.8, exploration: 0.1,
      achievement: 0.3, stimulation: 0.6, belonging: 0.7, focus: 0.3, comfort: 0.5,
    },
    constraints: { setting: "indoor", noise_level: "loud", physical_demand: "low", requires_booking: false, weather_dependent: false },
    preferred_windows: ["afternoon", "evening", "weekend"],
    group_size_fit: ["small", "medium"],
    tags: ["games", "casual", "social", "retro"],
  },

  {
    activity_key: "pool_darts",
    display_name: "Pool or darts",
    category: "competitive_games",
    short_description: "Something to do with your hands while you actually talk.",
    regional_availability: "anywhere",
    motive_weights: {
      restorative: 0.3, connection: 0.6, play: 0.7, exploration: 0.1,
      achievement: 0.4, stimulation: 0.5, belonging: 0.6, focus: 0.5, comfort: 0.7,
    },
    constraints: { setting: "indoor", noise_level: "moderate", physical_demand: "low", requires_booking: false, weather_dependent: false },
    preferred_windows: ["afternoon", "evening"],
    group_size_fit: ["small"],
    tags: ["games", "bar", "casual", "low-stakes"],
  },

  {
    activity_key: "poker_night",
    display_name: "Poker night",
    category: "competitive_games",
    short_description: "Low-stakes home game — the atmosphere matters more than the cards.",
    regional_availability: "anywhere",
    motive_weights: {
      restorative: 0.2, connection: 0.6, play: 0.8, exploration: 0.1,
      achievement: 0.5, stimulation: 0.6, belonging: 0.7, focus: 0.7, comfort: 0.6,
    },
    constraints: { setting: "indoor", noise_level: "moderate", physical_demand: "low", requires_booking: false, weather_dependent: false },
    preferred_windows: ["evening", "weekend"],
    group_size_fit: ["small", "medium"],
    tags: ["games", "home-friendly", "social", "recurring"],
  },

  {
    activity_key: "mini_golf",
    display_name: "Mini golf",
    category: "competitive_games",
    short_description: "Absurd and charming — a great first-plan format.",
    regional_availability: "suburban",
    motive_weights: {
      restorative: 0.4, connection: 0.6, play: 0.9, exploration: 0.1,
      achievement: 0.2, stimulation: 0.4, belonging: 0.5, focus: 0.3, comfort: 0.6,
    },
    constraints: { setting: "either", noise_level: "moderate", physical_demand: "low", requires_booking: false, weather_dependent: true },
    preferred_windows: ["afternoon", "evening", "weekend"],
    group_size_fit: ["small"],
    tags: ["games", "playful", "entry-level", "low-stakes"],
  },

  {
    activity_key: "esports_venue",
    display_name: "Esports venue or gaming lounge",
    category: "competitive_games",
    short_description: "High-spec setups and team games for people who take it seriously.",
    regional_availability: "urban_dense",
    motive_weights: {
      restorative: 0.1, connection: 0.5, play: 0.9, exploration: 0.2,
      achievement: 0.7, stimulation: 0.8, belonging: 0.7, focus: 0.7, comfort: 0.3,
    },
    constraints: { setting: "indoor", noise_level: "loud", physical_demand: "low", requires_booking: true, weather_dependent: false },
    preferred_windows: ["afternoon", "evening", "weekend"],
    group_size_fit: ["small", "medium"],
    tags: ["gaming", "competitive", "niche", "high-energy"],
  },

  // ─────────────────────────────────────────────
  // SPECTATING & LIVE EVENTS
  // ─────────────────────────────────────────────

  {
    activity_key: "sports_viewing_party",
    display_name: "Sports viewing party",
    category: "spectating_live_events",
    short_description: "A bar or home setup with people who care about the same game.",
    regional_availability: "anywhere",
    motive_weights: {
      restorative: 0.2, connection: 0.6, play: 0.5, exploration: 0.1,
      achievement: 0.3, stimulation: 0.8, belonging: 0.9, focus: 0.2, comfort: 0.6,
    },
    constraints: { setting: "either", noise_level: "loud", physical_demand: "low", requires_booking: false, weather_dependent: false },
    preferred_windows: ["afternoon", "evening", "weekend"],
    group_size_fit: ["small", "medium", "large"],
    tags: ["sports", "social", "communal", "recurring"],
  },

  {
    activity_key: "live_music",
    display_name: "Live music",
    category: "spectating_live_events",
    short_description: "A small venue, a good act, something real.",
    regional_availability: "urban_mid",
    motive_weights: {
      restorative: 0.2, connection: 0.6, play: 0.4, exploration: 0.5,
      achievement: 0.0, stimulation: 0.9, belonging: 0.7, focus: 0.1, comfort: 0.4,
    },
    constraints: { setting: "either", noise_level: "loud", physical_demand: "low", requires_booking: true, weather_dependent: false },
    preferred_windows: ["evening", "weekend"],
    group_size_fit: ["small", "medium"],
    tags: ["music", "evening", "cultural", "high-energy"],
  },

  {
    activity_key: "comedy_show",
    display_name: "Comedy show",
    category: "spectating_live_events",
    short_description: "Stand-up or improv — laughing at the same things means something.",
    regional_availability: "urban_mid",
    motive_weights: {
      restorative: 0.3, connection: 0.6, play: 0.9, exploration: 0.3,
      achievement: 0.0, stimulation: 0.7, belonging: 0.7, focus: 0.1, comfort: 0.5,
    },
    constraints: { setting: "indoor", noise_level: "loud", physical_demand: "low", requires_booking: true, weather_dependent: false },
    preferred_windows: ["evening", "weekend"],
    group_size_fit: ["small", "medium"],
    tags: ["entertainment", "humor", "evening", "social"],
  },

  {
    activity_key: "open_mic",
    display_name: "Open mic or spoken word",
    category: "spectating_live_events",
    short_description: "Raw talent, occasional disasters — always something to discuss after.",
    regional_availability: "urban_mid",
    motive_weights: {
      restorative: 0.3, connection: 0.5, play: 0.4, exploration: 0.7,
      achievement: 0.0, stimulation: 0.5, belonging: 0.6, focus: 0.3, comfort: 0.4,
    },
    constraints: { setting: "indoor", noise_level: "moderate", physical_demand: "low", requires_booking: false, weather_dependent: false },
    preferred_windows: ["evening"],
    group_size_fit: ["small", "medium"],
    tags: ["arts", "cultural", "low-cost", "discovery"],
  },

  {
    activity_key: "drag_show",
    display_name: "Drag show",
    category: "spectating_live_events",
    short_description: "Theatrical, loud, generous with energy — a crowd that shows up.",
    regional_availability: "urban_dense",
    motive_weights: {
      restorative: 0.1, connection: 0.6, play: 0.7, exploration: 0.5,
      achievement: 0.0, stimulation: 0.9, belonging: 0.8, focus: 0.1, comfort: 0.3,
    },
    constraints: { setting: "indoor", noise_level: "loud", physical_demand: "low", requires_booking: true, weather_dependent: false },
    preferred_windows: ["evening", "weekend"],
    group_size_fit: ["small", "medium"],
    tags: ["nightlife", "cultural", "queer", "high-energy"],
  },

  {
    activity_key: "theater_performance",
    display_name: "Theater or dance performance",
    category: "spectating_live_events",
    short_description: "Culture that gives you something to talk about afterward.",
    regional_availability: "urban_mid",
    motive_weights: {
      restorative: 0.3, connection: 0.5, play: 0.3, exploration: 0.6,
      achievement: 0.0, stimulation: 0.5, belonging: 0.4, focus: 0.5, comfort: 0.4,
    },
    constraints: { setting: "indoor", noise_level: "quiet", physical_demand: "low", requires_booking: true, weather_dependent: false },
    preferred_windows: ["evening", "weekend"],
    group_size_fit: ["small", "medium"],
    tags: ["arts", "culture", "evening", "conversation-starter"],
  },

  // ─────────────────────────────────────────────
  // FOOD & DRINK WITH TEXTURE
  // ─────────────────────────────────────────────

  {
    activity_key: "izakaya",
    display_name: "Izakaya or Japanese pub",
    category: "food_drink_texture",
    short_description: "Small plates, sake, and a format built for lingering.",
    regional_availability: "urban_dense",
    motive_weights: {
      restorative: 0.4, connection: 0.8, play: 0.3, exploration: 0.7,
      achievement: 0.0, stimulation: 0.5, belonging: 0.7, focus: 0.1, comfort: 0.7,
    },
    constraints: { setting: "indoor", noise_level: "moderate", physical_demand: "low", requires_booking: true, weather_dependent: false },
    preferred_windows: ["evening", "weekend"],
    group_size_fit: ["small", "medium"],
    tags: ["food", "cultural", "evening", "intimate"],
  },

  {
    activity_key: "hot_pot",
    display_name: "Hot pot",
    category: "food_drink_texture",
    short_description: "Communal cooking at the table — the format does the work.",
    regional_availability: "urban_dense",
    motive_weights: {
      restorative: 0.4, connection: 0.9, play: 0.4, exploration: 0.5,
      achievement: 0.0, stimulation: 0.4, belonging: 0.8, focus: 0.2, comfort: 0.8,
    },
    constraints: { setting: "indoor", noise_level: "moderate", physical_demand: "low", requires_booking: true, weather_dependent: false },
    preferred_windows: ["evening", "weekend"],
    group_size_fit: ["small", "medium"],
    tags: ["food", "communal", "cultural", "intimate"],
  },

  {
    activity_key: "brewery_taproom",
    display_name: "Brewery or taproom",
    category: "food_drink_texture",
    short_description: "Casual pints with a behind-the-scenes element if you want it.",
    regional_availability: "anywhere",
    motive_weights: {
      restorative: 0.3, connection: 0.7, play: 0.5, exploration: 0.4,
      achievement: 0.1, stimulation: 0.5, belonging: 0.8, focus: 0.1, comfort: 0.6,
    },
    constraints: { setting: "either", noise_level: "moderate", physical_demand: "low", requires_booking: false, weather_dependent: false },
    preferred_windows: ["afternoon", "evening", "weekend"],
    group_size_fit: ["small", "medium"],
    tags: ["drinks", "casual", "social", "neighborhood"],
  },

  {
    activity_key: "cocktail_bar",
    display_name: "Cocktail bar",
    category: "food_drink_texture",
    short_description: "A good bar with an intentional atmosphere and room to actually talk.",
    regional_availability: "urban_mid",
    motive_weights: {
      restorative: 0.4, connection: 0.8, play: 0.3, exploration: 0.4,
      achievement: 0.0, stimulation: 0.5, belonging: 0.7, focus: 0.1, comfort: 0.7,
    },
    constraints: { setting: "indoor", noise_level: "moderate", physical_demand: "low", requires_booking: false, weather_dependent: false },
    preferred_windows: ["evening", "weekend"],
    group_size_fit: ["small", "medium"],
    tags: ["drinks", "evening", "conversation", "relaxed"],
  },

  {
    activity_key: "ramen_crawl",
    display_name: "Ramen or noodle crawl",
    category: "food_drink_texture",
    short_description: "Hit two spots in the same area and compare notes.",
    regional_availability: "urban_dense",
    motive_weights: {
      restorative: 0.4, connection: 0.6, play: 0.4, exploration: 0.8,
      achievement: 0.2, stimulation: 0.4, belonging: 0.5, focus: 0.2, comfort: 0.7,
    },
    constraints: { setting: "either", noise_level: "moderate", physical_demand: "low", requires_booking: false, weather_dependent: false },
    preferred_windows: ["afternoon", "evening"],
    group_size_fit: ["small"],
    tags: ["food", "exploration", "cultural", "walkable"],
  },

  {
    activity_key: "food_market",
    display_name: "Food market or food hall",
    category: "food_drink_texture",
    short_description: "Graze through a market with no set plan for what you're eating.",
    regional_availability: "urban_mid",
    motive_weights: {
      restorative: 0.3, connection: 0.6, play: 0.5, exploration: 0.8,
      achievement: 0.0, stimulation: 0.6, belonging: 0.5, focus: 0.1, comfort: 0.4,
    },
    constraints: { setting: "either", noise_level: "loud", physical_demand: "low", requires_booking: false, weather_dependent: false },
    preferred_windows: ["afternoon", "weekend"],
    group_size_fit: ["small", "medium"],
    tags: ["food", "exploration", "casual", "walkable"],
  },

  {
    activity_key: "late_night_diner",
    display_name: "Late night diner run",
    category: "food_drink_texture",
    short_description: "Fries and coffee at midnight — the format is the point.",
    regional_availability: "anywhere",
    motive_weights: {
      restorative: 0.4, connection: 0.7, play: 0.4, exploration: 0.2,
      achievement: 0.0, stimulation: 0.3, belonging: 0.7, focus: 0.1, comfort: 0.9,
    },
    constraints: { setting: "indoor", noise_level: "moderate", physical_demand: "low", requires_booking: false, weather_dependent: false },
    preferred_windows: ["evening"],
    group_size_fit: ["small"],
    tags: ["food", "late-night", "casual", "comfort"],
  },

  {
    activity_key: "cooking_class",
    display_name: "Cooking class",
    category: "food_drink_texture",
    short_description: "Learn a specific technique — then eat what you made.",
    regional_availability: "urban_mid",
    motive_weights: {
      restorative: 0.2, connection: 0.6, play: 0.5, exploration: 0.6,
      achievement: 0.6, stimulation: 0.5, belonging: 0.6, focus: 0.6, comfort: 0.4,
    },
    constraints: { setting: "indoor", noise_level: "moderate", physical_demand: "low", requires_booking: true, weather_dependent: false },
    preferred_windows: ["afternoon", "evening", "weekend"],
    group_size_fit: ["small", "medium"],
    tags: ["food", "learning", "hands-on", "skill"],
  },

  {
    activity_key: "brunch",
    display_name: "Brunch",
    category: "food_drink_texture",
    short_description: "Unhurried late-morning meal — one of the better first-plan formats.",
    regional_availability: "anywhere",
    motive_weights: {
      restorative: 0.6, connection: 0.8, play: 0.3, exploration: 0.3,
      achievement: 0.0, stimulation: 0.3, belonging: 0.7, focus: 0.1, comfort: 0.8,
    },
    constraints: { setting: "either", noise_level: "moderate", physical_demand: "low", requires_booking: true, weather_dependent: false },
    preferred_windows: ["morning", "weekend"],
    group_size_fit: ["small", "medium"],
    tags: ["food", "casual", "weekend", "entry-level"],
  },

  // ─────────────────────────────────────────────
  // CREATIVE & MAKING
  // ─────────────────────────────────────────────

  {
    activity_key: "pottery_ceramics",
    display_name: "Pottery or ceramics",
    category: "creative_making",
    short_description: "Make something with your hands — a surprisingly good conversation format.",
    regional_availability: "urban_mid",
    motive_weights: {
      restorative: 0.6, connection: 0.6, play: 0.6, exploration: 0.4,
      achievement: 0.5, stimulation: 0.3, belonging: 0.5, focus: 0.8, comfort: 0.6,
    },
    constraints: { setting: "indoor", noise_level: "quiet", physical_demand: "low", requires_booking: true, weather_dependent: false },
    preferred_windows: ["afternoon", "evening", "weekend"],
    group_size_fit: ["small", "medium"],
    tags: ["creative", "hands-on", "skill", "restorative"],
  },

  {
    activity_key: "mural_graffiti_tour",
    display_name: "Mural or street art tour",
    category: "creative_making",
    short_description: "Walk a neighborhood looking specifically at what's on the walls.",
    regional_availability: "urban_mid",
    motive_weights: {
      restorative: 0.4, connection: 0.5, play: 0.3, exploration: 0.9,
      achievement: 0.0, stimulation: 0.4, belonging: 0.3, focus: 0.4, comfort: 0.4,
    },
    constraints: { setting: "outdoor", noise_level: "moderate", physical_demand: "low", requires_booking: false, weather_dependent: true },
    preferred_windows: ["afternoon", "weekend"],
    group_size_fit: ["solo", "small"],
    tags: ["art", "outdoor", "exploration", "cultural"],
  },

  {
    activity_key: "music_production_workshop",
    display_name: "Music production workshop",
    category: "creative_making",
    short_description: "Beat-making or sampling — usually a one-session intro.",
    regional_availability: "urban_dense",
    motive_weights: {
      restorative: 0.2, connection: 0.4, play: 0.6, exploration: 0.6,
      achievement: 0.6, stimulation: 0.6, belonging: 0.4, focus: 0.8, comfort: 0.2,
    },
    constraints: { setting: "indoor", noise_level: "moderate", physical_demand: "low", requires_booking: true, weather_dependent: false },
    preferred_windows: ["afternoon", "evening", "weekend"],
    group_size_fit: ["small"],
    tags: ["music", "creative", "skill", "niche"],
  },

  {
    activity_key: "photography_walk",
    display_name: "Photography walk",
    category: "creative_making",
    short_description: "Explore an area with cameras out — compare what you noticed.",
    regional_availability: "anywhere",
    motive_weights: {
      restorative: 0.6, connection: 0.5, play: 0.4, exploration: 0.8,
      achievement: 0.4, stimulation: 0.4, belonging: 0.3, focus: 0.7, comfort: 0.4,
    },
    constraints: { setting: "outdoor", noise_level: "moderate", physical_demand: "low", requires_booking: false, weather_dependent: true },
    preferred_windows: ["morning", "afternoon", "weekend"],
    group_size_fit: ["solo", "small"],
    tags: ["creative", "outdoor", "exploration", "solo-friendly"],
  },

  {
    activity_key: "screen_printing_workshop",
    display_name: "Screen printing or zine-making",
    category: "creative_making",
    short_description: "Make something you'll actually keep. Low-tech, satisfying.",
    regional_availability: "urban_dense",
    motive_weights: {
      restorative: 0.4, connection: 0.5, play: 0.6, exploration: 0.4,
      achievement: 0.6, stimulation: 0.3, belonging: 0.5, focus: 0.7, comfort: 0.4,
    },
    constraints: { setting: "indoor", noise_level: "moderate", physical_demand: "low", requires_booking: true, weather_dependent: false },
    preferred_windows: ["afternoon", "evening", "weekend"],
    group_size_fit: ["small", "medium"],
    tags: ["creative", "hands-on", "niche", "one-time"],
  },

  {
    activity_key: "painting_drawing_class",
    display_name: "Painting or drawing class",
    category: "creative_making",
    short_description: "A structured class where nobody takes themselves too seriously.",
    regional_availability: "urban_mid",
    motive_weights: {
      restorative: 0.6, connection: 0.5, play: 0.6, exploration: 0.4,
      achievement: 0.4, stimulation: 0.3, belonging: 0.5, focus: 0.7, comfort: 0.6,
    },
    constraints: { setting: "indoor", noise_level: "quiet", physical_demand: "low", requires_booking: true, weather_dependent: false },
    preferred_windows: ["afternoon", "evening", "weekend"],
    group_size_fit: ["small", "medium"],
    tags: ["creative", "hands-on", "skill", "low-stakes"],
  },

  // ─────────────────────────────────────────────
  // AMBIENT & LOW-KEY
  // ─────────────────────────────────────────────

  {
    activity_key: "coffee_shop",
    display_name: "Coffee shop",
    category: "ambient_low_key",
    short_description: "The lowest bar that still counts — a good local spot.",
    regional_availability: "anywhere",
    motive_weights: {
      restorative: 0.6, connection: 0.8, play: 0.2, exploration: 0.2,
      achievement: 0.0, stimulation: 0.2, belonging: 0.6, focus: 0.3, comfort: 0.8,
    },
    constraints: { setting: "indoor", noise_level: "moderate", physical_demand: "low", requires_booking: false, weather_dependent: false },
    preferred_windows: ["morning", "afternoon", "weekend"],
    group_size_fit: ["solo", "small"],
    tags: ["casual", "conversation", "entry-level", "low-commitment"],
  },

  {
    activity_key: "record_bookstore",
    display_name: "Record store or bookstore",
    category: "ambient_low_key",
    short_description: "Wander shelves with someone — see what they reach for.",
    regional_availability: "urban_mid",
    motive_weights: {
      restorative: 0.7, connection: 0.5, play: 0.3, exploration: 0.6,
      achievement: 0.0, stimulation: 0.3, belonging: 0.3, focus: 0.5, comfort: 0.7,
    },
    constraints: { setting: "indoor", noise_level: "quiet", physical_demand: "low", requires_booking: false, weather_dependent: false },
    preferred_windows: ["afternoon", "weekend"],
    group_size_fit: ["solo", "small"],
    tags: ["quiet", "cultural", "low-key", "conversation-starter"],
  },

  {
    activity_key: "thrift_vintage_run",
    display_name: "Thrift or vintage shopping",
    category: "ambient_low_key",
    short_description: "No goal, a small budget, a few good finds — better with company.",
    regional_availability: "anywhere",
    motive_weights: {
      restorative: 0.5, connection: 0.6, play: 0.5, exploration: 0.7,
      achievement: 0.2, stimulation: 0.3, belonging: 0.3, focus: 0.3, comfort: 0.5,
    },
    constraints: { setting: "indoor", noise_level: "moderate", physical_demand: "low", requires_booking: false, weather_dependent: false },
    preferred_windows: ["afternoon", "weekend"],
    group_size_fit: ["solo", "small"],
    tags: ["casual", "exploration", "low-cost", "low-commitment"],
  },

  {
    activity_key: "farmers_market",
    display_name: "Farmers market",
    category: "ambient_low_key",
    short_description: "Wander a Saturday market with no agenda — probably end up with cheese.",
    regional_availability: "anywhere",
    motive_weights: {
      restorative: 0.5, connection: 0.6, play: 0.3, exploration: 0.6,
      achievement: 0.0, stimulation: 0.4, belonging: 0.5, focus: 0.1, comfort: 0.6,
    },
    constraints: { setting: "outdoor", noise_level: "moderate", physical_demand: "low", requires_booking: false, weather_dependent: true },
    preferred_windows: ["morning", "weekend"],
    group_size_fit: ["solo", "small"],
    tags: ["weekend-morning", "casual", "neighborhood", "seasonal"],
  },

  {
    activity_key: "park_hang",
    display_name: "Park hang",
    category: "ambient_low_key",
    short_description: "No agenda. Find a good spot and settle in.",
    regional_availability: "anywhere",
    motive_weights: {
      restorative: 0.9, connection: 0.6, play: 0.3, exploration: 0.2,
      achievement: 0.0, stimulation: 0.2, belonging: 0.5, focus: 0.1, comfort: 0.8,
    },
    constraints: { setting: "outdoor", noise_level: "quiet", physical_demand: "low", requires_booking: false, weather_dependent: true },
    preferred_windows: ["afternoon", "weekend"],
    group_size_fit: ["solo", "small", "medium"],
    tags: ["relaxed", "outdoor", "low-commitment", "seasonal"],
  },

  {
    activity_key: "neighborhood_walk",
    display_name: "Neighborhood or architecture walk",
    category: "ambient_low_key",
    short_description: "Wander an area neither of you knows well.",
    regional_availability: "anywhere",
    motive_weights: {
      restorative: 0.5, connection: 0.6, play: 0.2, exploration: 0.8,
      achievement: 0.0, stimulation: 0.3, belonging: 0.3, focus: 0.3, comfort: 0.5,
    },
    constraints: { setting: "outdoor", noise_level: "moderate", physical_demand: "low", requires_booking: false, weather_dependent: true },
    preferred_windows: ["afternoon", "weekend"],
    group_size_fit: ["solo", "small"],
    tags: ["exploration", "walkable", "low-commitment", "urban"],
  },

  // ─────────────────────────────────────────────
  // WELLNESS & BODY
  // ─────────────────────────────────────────────

  {
    activity_key: "yoga_class",
    display_name: "Yoga class",
    category: "wellness_body",
    short_description: "A class you go to together — not one you suffer through alone.",
    regional_availability: "anywhere",
    motive_weights: {
      restorative: 0.8, connection: 0.4, play: 0.1, exploration: 0.2,
      achievement: 0.3, stimulation: 0.2, belonging: 0.5, focus: 0.7, comfort: 0.6,
    },
    constraints: { setting: "indoor", noise_level: "quiet", physical_demand: "medium", requires_booking: true, weather_dependent: false },
    preferred_windows: ["morning", "afternoon", "weekend"],
    group_size_fit: ["solo", "small", "medium"],
    tags: ["wellness", "active", "mindful", "routine"],
  },

  {
    activity_key: "bachata_salsa_class",
    display_name: "Salsa, bachata, or hip hop class",
    category: "wellness_body",
    short_description: "Structured enough to not feel lost — social enough to matter.",
    regional_availability: "urban_dense",
    motive_weights: {
      restorative: 0.2, connection: 0.8, play: 0.7, exploration: 0.3,
      achievement: 0.4, stimulation: 0.8, belonging: 0.8, focus: 0.5, comfort: 0.3,
    },
    constraints: { setting: "indoor", noise_level: "loud", physical_demand: "medium", requires_booking: true, weather_dependent: false },
    preferred_windows: ["evening", "weekend"],
    group_size_fit: ["small", "medium"],
    tags: ["active", "social", "cultural", "skill"],
  },

  {
    activity_key: "sauna_cold_plunge",
    display_name: "Sauna and cold plunge",
    category: "wellness_body",
    short_description: "Shared suffering is a fast bonding mechanism.",
    regional_availability: "urban_dense",
    motive_weights: {
      restorative: 0.9, connection: 0.5, play: 0.2, exploration: 0.3,
      achievement: 0.5, stimulation: 0.5, belonging: 0.4, focus: 0.5, comfort: 0.6,
    },
    constraints: { setting: "indoor", noise_level: "quiet", physical_demand: "medium", requires_booking: true, weather_dependent: false },
    preferred_windows: ["morning", "afternoon", "weekend"],
    group_size_fit: ["small"],
    tags: ["wellness", "restorative", "bonding", "trending"],
  },

  {
    activity_key: "aerial_silks",
    display_name: "Aerial silks or circus arts intro",
    category: "wellness_body",
    short_description: "Physical, weird, and more fun than expected.",
    regional_availability: "urban_dense",
    motive_weights: {
      restorative: 0.1, connection: 0.5, play: 0.7, exploration: 0.5,
      achievement: 0.7, stimulation: 0.7, belonging: 0.5, focus: 0.6, comfort: 0.1,
    },
    constraints: { setting: "indoor", noise_level: "moderate", physical_demand: "high", requires_booking: true, weather_dependent: false },
    preferred_windows: ["afternoon", "evening", "weekend"],
    group_size_fit: ["small"],
    tags: ["active", "unusual", "physical", "niche"],
  },

  {
    activity_key: "sound_bath",
    display_name: "Sound bath",
    category: "wellness_body",
    short_description: "Lie on the floor and let the sound do something to you.",
    regional_availability: "urban_mid",
    motive_weights: {
      restorative: 0.9, connection: 0.3, play: 0.1, exploration: 0.4,
      achievement: 0.0, stimulation: 0.3, belonging: 0.4, focus: 0.7, comfort: 0.8,
    },
    constraints: { setting: "indoor", noise_level: "quiet", physical_demand: "low", requires_booking: true, weather_dependent: false },
    preferred_windows: ["evening", "weekend"],
    group_size_fit: ["solo", "small", "medium"],
    tags: ["wellness", "mindful", "restorative", "unusual"],
  },

  // ─────────────────────────────────────────────
  // NIGHT & SOCIAL
  // ─────────────────────────────────────────────

  {
    activity_key: "karaoke",
    display_name: "Karaoke",
    category: "night_social",
    short_description: "Private room or bar — commitment to embarrassment is the point.",
    regional_availability: "urban_mid",
    motive_weights: {
      restorative: 0.1, connection: 0.7, play: 1.0, exploration: 0.2,
      achievement: 0.2, stimulation: 0.9, belonging: 0.9, focus: 0.1, comfort: 0.4,
    },
    constraints: { setting: "indoor", noise_level: "loud", physical_demand: "low", requires_booking: true, weather_dependent: false },
    preferred_windows: ["evening", "weekend"],
    group_size_fit: ["small", "medium"],
    tags: ["nightlife", "playful", "social", "high-energy"],
  },

  {
    activity_key: "social_dancing",
    display_name: "Social dance night",
    category: "night_social",
    short_description: "A venue with a floor and people actually using it.",
    regional_availability: "urban_dense",
    motive_weights: {
      restorative: 0.1, connection: 0.8, play: 0.7, exploration: 0.3,
      achievement: 0.3, stimulation: 0.9, belonging: 0.8, focus: 0.4, comfort: 0.3,
    },
    constraints: { setting: "indoor", noise_level: "loud", physical_demand: "medium", requires_booking: false, weather_dependent: false },
    preferred_windows: ["evening", "weekend"],
    group_size_fit: ["small", "medium"],
    tags: ["nightlife", "dancing", "social", "cultural"],
  },

  {
    activity_key: "jazz_club_speakeasy",
    display_name: "Jazz club or speakeasy",
    category: "night_social",
    short_description: "Craft drinks, low lighting, and music that earns the atmosphere.",
    regional_availability: "urban_dense",
    motive_weights: {
      restorative: 0.4, connection: 0.7, play: 0.3, exploration: 0.5,
      achievement: 0.0, stimulation: 0.7, belonging: 0.6, focus: 0.2, comfort: 0.6,
    },
    constraints: { setting: "indoor", noise_level: "moderate", physical_demand: "low", requires_booking: true, weather_dependent: false },
    preferred_windows: ["evening", "weekend"],
    group_size_fit: ["small"],
    tags: ["nightlife", "intimate", "music", "aesthetic"],
  },

  {
    activity_key: "rooftop_bar",
    display_name: "Rooftop bar",
    category: "night_social",
    short_description: "Good weather, good view, and a reason to make plans.",
    regional_availability: "urban_dense",
    motive_weights: {
      restorative: 0.3, connection: 0.7, play: 0.4, exploration: 0.3,
      achievement: 0.0, stimulation: 0.6, belonging: 0.6, focus: 0.1, comfort: 0.5,
    },
    constraints: { setting: "outdoor", noise_level: "moderate", physical_demand: "low", requires_booking: false, weather_dependent: true },
    preferred_windows: ["evening", "weekend"],
    group_size_fit: ["small", "medium"],
    tags: ["nightlife", "social", "drinks", "seasonal"],
  },

  {
    activity_key: "game_night_hosted",
    display_name: "Hosted game night",
    category: "night_social",
    short_description: "Someone's place, a mix of people, the right games.",
    regional_availability: "anywhere",
    motive_weights: {
      restorative: 0.3, connection: 0.7, play: 0.9, exploration: 0.1,
      achievement: 0.3, stimulation: 0.6, belonging: 0.9, focus: 0.4, comfort: 0.8,
    },
    constraints: { setting: "indoor", noise_level: "moderate", physical_demand: "low", requires_booking: false, weather_dependent: false },
    preferred_windows: ["evening", "weekend"],
    group_size_fit: ["small", "medium"],
    tags: ["games", "home-format", "social", "community"],
  },

  // ─────────────────────────────────────────────
  // SEASONAL & OCCASIONAL
  // ─────────────────────────────────────────────

  {
    activity_key: "ice_skating",
    display_name: "Ice skating",
    category: "seasonal_occasional",
    short_description: "Seasonal, slightly chaotic, and reliably fun for a group.",
    regional_availability: "anywhere",
    motive_weights: {
      restorative: 0.3, connection: 0.6, play: 0.8, exploration: 0.1,
      achievement: 0.3, stimulation: 0.6, belonging: 0.6, focus: 0.3, comfort: 0.4,
    },
    constraints: { setting: "either", noise_level: "moderate", physical_demand: "medium", requires_booking: false, weather_dependent: false },
    preferred_windows: ["afternoon", "evening", "weekend"],
    group_size_fit: ["small", "medium"],
    tags: ["seasonal", "winter", "playful", "low-stakes"],
  },

  {
    activity_key: "outdoor_movie",
    display_name: "Outdoor movie screening",
    category: "seasonal_occasional",
    short_description: "A film under the sky — better because it's temporary.",
    regional_availability: "urban_mid",
    motive_weights: {
      restorative: 0.6, connection: 0.5, play: 0.3, exploration: 0.3,
      achievement: 0.0, stimulation: 0.3, belonging: 0.5, focus: 0.4, comfort: 0.7,
    },
    constraints: { setting: "outdoor", noise_level: "quiet", physical_demand: "low", requires_booking: false, weather_dependent: true },
    preferred_windows: ["evening", "weekend"],
    group_size_fit: ["small", "medium"],
    tags: ["seasonal", "summer", "film", "relaxed"],
  },

  {
    activity_key: "street_fair_festival",
    display_name: "Street fair or music festival",
    category: "seasonal_occasional",
    short_description: "Something happening in the city that's worth actually showing up for.",
    regional_availability: "urban_mid",
    motive_weights: {
      restorative: 0.1, connection: 0.6, play: 0.6, exploration: 0.6,
      achievement: 0.0, stimulation: 0.9, belonging: 0.8, focus: 0.0, comfort: 0.3,
    },
    constraints: { setting: "outdoor", noise_level: "loud", physical_demand: "low", requires_booking: false, weather_dependent: true },
    preferred_windows: ["afternoon", "evening", "weekend"],
    group_size_fit: ["small", "medium", "large"],
    tags: ["seasonal", "music", "community", "outdoor"],
  },

  {
    activity_key: "holiday_market",
    display_name: "Holiday market",
    category: "seasonal_occasional",
    short_description: "Hot drinks, vendor stalls, a reason to be outside in winter.",
    regional_availability: "urban_mid",
    motive_weights: {
      restorative: 0.4, connection: 0.6, play: 0.3, exploration: 0.5,
      achievement: 0.0, stimulation: 0.4, belonging: 0.6, focus: 0.1, comfort: 0.7,
    },
    constraints: { setting: "outdoor", noise_level: "moderate", physical_demand: "low", requires_booking: false, weather_dependent: true },
    preferred_windows: ["afternoon", "evening", "weekend"],
    group_size_fit: ["small", "medium"],
    tags: ["seasonal", "winter", "casual", "neighborhood"],
  },

  {
    activity_key: "flea_market",
    display_name: "Flea market or pop-up",
    category: "seasonal_occasional",
    short_description: "Occasional, outdoor, full of things worth having opinions about.",
    regional_availability: "anywhere",
    motive_weights: {
      restorative: 0.4, connection: 0.5, play: 0.4, exploration: 0.8,
      achievement: 0.2, stimulation: 0.4, belonging: 0.4, focus: 0.2, comfort: 0.5,
    },
    constraints: { setting: "outdoor", noise_level: "moderate", physical_demand: "low", requires_booking: false, weather_dependent: true },
    preferred_windows: ["morning", "afternoon", "weekend"],
    group_size_fit: ["solo", "small"],
    tags: ["seasonal", "casual", "exploration", "low-cost"],
  },

];

// ─────────────────────────────────────────────
// Validation helpers (used in seed script)
// ─────────────────────────────────────────────

export function validateCatalog(entries: ActivityCatalogEntry[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const keys = entries.map((e) => e.activity_key);
  const duplicates = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (duplicates.length > 0) errors.push(`Duplicate activity_keys: ${duplicates.join(", ")}`);

  const motiveKeys: (keyof MotiveWeights)[] = [
    "restorative", "connection", "play", "exploration",
    "achievement", "stimulation", "belonging", "focus", "comfort",
  ];

  const validCategories = [
    "high_energy_physical", "competitive_games", "spectating_live_events",
    "food_drink_texture", "creative_making", "ambient_low_key",
    "wellness_body", "night_social", "seasonal_occasional",
  ];

  const validRegions: RegionalAvailability[] = ["anywhere", "suburban", "urban_mid", "urban_dense"];

  for (const entry of entries) {
    if (!entry.activity_key.match(/^[a-z][a-z0-9_]*$/)) {
      errors.push(`${entry.activity_key}: activity_key must be snake_case`);
    }
    if (entry.short_description.split(" ").length > 15) {
      errors.push(`${entry.activity_key}: short_description exceeds 15 words`);
    }
    if (!validCategories.includes(entry.category)) {
      errors.push(`${entry.activity_key}: unknown category "${entry.category}"`);
    }
    if (!validRegions.includes(entry.regional_availability)) {
      errors.push(`${entry.activity_key}: unknown regional_availability "${entry.regional_availability}"`);
    }
    for (const motive of motiveKeys) {
      const v = entry.motive_weights[motive];
      if (typeof v !== "number" || v < 0 || v > 1) {
        errors.push(`${entry.activity_key}: motive ${motive} out of range (${v})`);
      }
    }
    if (entry.group_size_fit.length === 0) {
      errors.push(`${entry.activity_key}: must have at least one group_size_fit value`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export const CATALOG_STATS = {
  total: ACTIVITY_CATALOG.length,
  by_category: ACTIVITY_CATALOG.reduce<Record<string, number>>((acc, e) => {
    acc[e.category] = (acc[e.category] ?? 0) + 1;
    return acc;
  }, {}),
  by_region: ACTIVITY_CATALOG.reduce<Record<string, number>>((acc, e) => {
    acc[e.regional_availability] = (acc[e.regional_availability] ?? 0) + 1;
    return acc;
  }, {}),
  solo_friendly: ACTIVITY_CATALOG.filter((e) => e.group_size_fit.includes("solo")).length,
  outdoor: ACTIVITY_CATALOG.filter((e) => e.constraints.setting === "outdoor").length,
  weather_independent: ACTIVITY_CATALOG.filter((e) => !e.constraints.weather_dependent).length,
};