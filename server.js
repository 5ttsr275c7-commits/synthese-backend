// backend/server.js
//
// Backend minimal à déployer (Vercel, Render, Fly.io, un VPS...) qui :
//  1. Appelle l'API Anthropic pour générer les actus au format "pyramide"
//  2. Sert la citation du jour et la carte Culture G du soir
//  3. Proxifie l'API TTS (ElevenLabs) pour ne jamais exposer la clé côté app
//
// Installation : npm init -y && npm install express @anthropic-ai/sdk cors dotenv
// Lancement    : node server.js
//
// Variables d'environnement à définir (fichier .env) :
//   ANTHROPIC_API_KEY=sk-ant-...
//   ELEVENLABS_API_KEY=...
//   ELEVENLABS_VOICE_ID=...          (voix française premium de votre choix)
//   PORT=3000

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
app.use(cors());
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Cache mémoire très simple : régénère une seule fois par jour/session.
// En production, remplacez par une vraie base (Postgres, Redis...) +
// un vrai comité éditorial de validation avant mise en ligne (cf. CDCF §4.2).
let cacheBriefMatin = null;
let cacheBriefSoir = null;
let cacheDate = null;

function estAujourdhui(date) {
  const now = new Date();
  return date && date.toDateString() === now.toDateString();
}

// ─────────────────────────────────────────────────────────────
// GET /api/brief-matin  →  { citation, actus: [NewsCard...] }
// ─────────────────────────────────────────────────────────────
app.get('/api/brief-matin', async (req, res) => {
  try {
    if (cacheBriefMatin && estAujourdhui(cacheDate)) {
      return res.json(cacheBriefMatin);
    }

    const prompt = `Tu es le moteur éditorial de l'app "Synthèse". Génère le brief du matin
au format JSON STRICT (rien d'autre que le JSON, pas de markdown), avec :
{
  "citation": { "text": "...", "author": "..." },
  "actus": [
    {
      "titre": "...",
      "impactChoc": "phrase choc résumant l'impact mondial",
      "quoi": "...", "pourquoi": "...", "etApres": "...",
      "analyseApprofondie": "3-4 phrases d'analyse de fond",
      "visionEuropeenne": "...", "visionAmericaine": "...", "visionAsiatique": "..."
    }
  ]  // exactement 3 actus majeures et vérifiées du jour, factuelles
}
Utilise la recherche web pour te baser sur l'actualité réelle du jour.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }],
    });

    const texte = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const json = JSON.parse(texte.replace(/```json|```/g, '').trim());

    // ⚠️ TODO PRODUCTION : ici doit intervenir votre comité de curation
    // humaine (journalistes/éditeurs) avant publication, comme prévu au CDCF.

    cacheBriefMatin = json;
    cacheDate = new Date();
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
    if (cacheBriefSoir && estAujourdhui(cacheDate)) {
      return res.json(cacheBriefSoir);
    }

    const joursDiscipline = {
      1: null, 2: 'art', 3: 'relationsInternationales',
      4: 'sciences', 5: 'philosophie', 6: 'histoire', 0: null,
    };
    const discipline = joursDiscipline[new Date().getDay()];

    const prompt = discipline
      ? `Génère UNE notion de culture générale en discipline "${discipline}" pour l'app
"Synthèse", au format JSON strict :
{
  "cultureCard": {
    "discipline": "${discipline}",
    "titre": "...", "contenu": "30 à 50 mots maximum, percutant et imagé",
    "glossaire": [{ "mot": "...", "definition": "15 mots max" }],
    "quizAssocie": { "question": "...", "choix": ["...", "...", "..."], "bonneReponseIndex": 0 }
  },
  "bilan": ["3 à 5 puces ultra-courtes résumant les événements marquants depuis ce matin, basées sur l'actualité réelle du jour"]
}`
      : `Dimanche : pas de nouvelle notion. Réponds en JSON strict :
{ "cultureCard": null, "bilan": ["3 à 5 puces résumant les événements marquants de la journée"] }`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }],
    });

    const texte = response.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const json = JSON.parse(texte.replace(/```json|```/g, '').trim());

    cacheBriefSoir = json;
    res.json(json);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Génération du brief du soir impossible.' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/citation-du-jour  →  { text, author }   (utilisé par le widget)
// ─────────────────────────────────────────────────────────────
app.get('/api/citation-du-jour', async (req, res) => {
  if (cacheBriefMatin?.citation && estAujourdhui(cacheDate)) {
    return res.json(cacheBriefMatin.citation);
  }
  // Déclenche la génération du brief complet si pas encore fait aujourd'hui
  req.url = '/api/brief-matin';
  app._router.handle(req, res);
});

// ─────────────────────────────────────────────────────────────
// POST /api/tts  { text }  →  audio/mpeg (proxy ElevenLabs)
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
