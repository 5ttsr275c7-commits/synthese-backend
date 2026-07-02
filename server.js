// backend/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(cors());
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Cache mémoire distinct pour le matin et le soir
let cacheBriefMatin = null;
let cacheBriefSoir = null;
let cacheDateMatin = null;
let cacheDateSoir = null;

function estAujourdhui(date) {
  const now = new Date();
  return date && date.toDateString() === now.toDateString();
}

// ─────────────────────────────────────────────────────────────
// GET /api/brief-matin  →  { citation, actus: [NewsCard...] }
// ─────────────────────────────────────────────────────────────
app.get('/api/brief-matin', async (req, res) => {
  try {
    if (cacheBriefMatin && estAujourdhui(cacheDateMatin)) {
      console.log("=== [Cache Matin] Données servies depuis la mémoire ===");
      return res.json(cacheBriefMatin);
    }

    console.log("=== [Cache Matin] Génération via Claude avec recherche Web... ===");

    const prompt = `Tu es le moteur éditorial de l'app "Synthèse". Génère le brief du matin
au format JSON STRICT. Tu ne dois TOUT SIMPLEMENT PAS écrire de phrases d'introduction ou de conclusion. Renvoie UNIQUEMENT le bloc JSON, sans balises markdown de code.

Voici la structure attendue :
{
  "citation": { "text": "La citation ici", "author": "L'auteur" },
  "actus": [
    {
      "titre": "Titre de l'actu",
      "impactChoc": "Une phrase choc résumant l'impact mondial",
      "quoi": "Explications factuelles du quoi", 
      "pourquoi": "Explications du pourquoi", 
      "etApres": "Perspectives futures",
      "analyseApprofondie": "3-4 sentences d'analyse de fond",
      "visionEuropeenne": "Position ou impact en Europe", 
      "visionAmericaine": "Position ou impact aux USA", 
      "visionAsiatique": "Position ou impact en Asie"
    }
  ]
}
Génère exactement 3 actualités majeures et vérifiées du jour en utilisant ton outil de recherche web.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }],
    });

    const texte = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    
    // Isolation chirurgicale du JSON
    const debutJson = texte.indexOf('{');
    const finJson = texte.lastIndexOf('}');

    if (debutJson === -1 || finJson === -1) {
      throw new Error("L'IA n'a pas renvoyé de structure JSON valide pour le matin.");
    }

    const jsonPur = texte.substring(debutJson, finJson + 1);
    const json = JSON.parse(jsonPur);

    cacheBriefMatin = json;
    cacheDateMatin = new Date();
    res.json(json);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Génération du brief du matin impossible.' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/brief-soir  →  { cultureCard, bilan: [String...] }
// ─────────────────────────────────────────────────────────────
app.get('/api/brief-soir', async (req, res) => {
  try {
    if (cacheBriefSoir && estAujourdhui(cacheDateSoir)) {
      console.log("=== [Cache Soir] Données servies depuis la mémoire ===");
      return res.json(cacheBriefSoir);
    }

    console.log("=== [Cache Soir] Génération via Claude avec recherche Web... ===");

    // 0 = Dimanche, 1 = Lundi, 2 = Mardi, etc.
    const joursDiscipline = {
      1: 'art', 2: 'relationsInternationales', 3: 'sciences',
      4: 'philosophie', 5: 'histoire', 6: 'art', 0: null
    };
    const discipline = joursDiscipline[new Date().getDay()];

    const prompt = discipline
      ? `Génère UNE notion de culture générale en discipline "${discipline}" pour l'app "Synthèse", au format JSON STRICT. Ne produis aucun texte en dehors du JSON. Pas de blabla, pas de balises markdown.

Structure attendue :
{
  "cultureCard": {
    "discipline": "${discipline}",
    "titre": "Le titre de la notion", 
    "contenu": "30 à 50 mots maximum, percutant et imagé",
    "glossaire": [{ "mot": "Un mot technique", "definition": "15 mots max" }],
    "quizAssocie": { 
      "question": "La question du quiz", 
      "choix": ["Option 1", "Option 2", "Option 3"], 
      "bonneReponseIndex": 0 
    }
  },
  "bilan": [
    "Première puce courte résumant un événement marquant de la journée",
    "Deuxième puce courte",
    "Troisième puce courte"
  ]
}
Utilise la recherche web pour construire un "bilan" basé sur les vrais événements de la journée.`
      : `Réponds en JSON strict uniquement : { "cultureCard": null, "bilan": ["3 à 5 puces résumant les événements marquants de la journée d'aujourd'hui"] }`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }],
    });

    const texte = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    
    // Isolation chirurgicale du JSON
    const debutJson = texte.indexOf('{');
    const finJson = texte.lastIndexOf('}');

    if (debutJson === -1 || finJson === -1) {
      throw new Error("L'IA n'a pas renvoyé de structure JSON valide pour le soir.");
    }

    const jsonPur = texte.substring(debutJson, finJson + 1);
    const json = JSON.parse(jsonPur);

    cacheBriefSoir = json;
    cacheDateSoir = new Date();
    res.json(json);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Génération du brief du soir impossible.' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/citation-du-jour  →  { text, author }
// ─────────────────────────────────────────────────────────────
app.get('/api/citation-du-jour', async (req, res) => {
  if (cacheBriefMatin?.citation && estAujourdhui(cacheDateMatin)) {
    return res.json(cacheBriefMatin.citation);
  }
  req.url = '/api/brief-matin';
  app._router.handle(req, res);
});

// ─────────────────────────────────────────────────────────────
// POST /api/tts
// ─────────────────────────────────────────────────────────────
app.post('/api/tts', async (req, res) => {
  try {
    const { text } = req.body;
    const voiceId = process.env.ELEVENLABS_VOICE_ID;

    const elevenRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.4, similarity_boost: 0.8 },
      }),
    });

    if (!elevenRes.ok) throw new Error(`ElevenLabs error ${elevenRes.status}`);

    res.set('Content-Type', 'audio/mpeg');
    const buffer = Buffer.from(await elevenRes.arrayBuffer());
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'TTS premium indisponible.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Backend Synthèse actif sur le port ${PORT}`));
