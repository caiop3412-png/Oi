const express = require("express");
const { exec, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ✅ Chave de autenticação
const API_KEY = "jhony1232443_14";

// ✅ Fila de downloads
let fila = [];
let processando = false;

// ✅ Verifica se ffmpeg está instalado
function ffmpegDisponivel() {
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// ✅ Middleware de autenticação
function autenticar(req, res, next) {
  const chave = req.headers["x-api-key"] || req.query.api_key;
  if (chave !== API_KEY) {
    return res.status(401).json({ error: "❌ Chave de API inválida ou ausente." });
  }
  next();
}

const DOWNLOAD_DIR = path.join(__dirname, "downloads");
if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR);

const PLATAFORMAS = [
  "YouTube", "Instagram", "TikTok", "Twitter/X",
  "Facebook", "Twitch", "Reddit", "Vimeo", "e mais de 1000 sites"
];

// ✅ Processa a fila um por um
function processarFila() {
  if (processando || fila.length === 0) return;
  processando = true;

  const { comando, filepath, filename, res, tipo } = fila.shift();

  console.log(`⚙️ Processando: ${filename} | Fila restante: ${fila.length}`);

  exec(comando, { timeout: 600000 }, (error, stdout, stderr) => {
    processando = false;

    if (error) {
      console.error("❌ Erro:", stderr);
      if (!res.headersSent) {
        res.status(500).json({ error: "Falha ao processar.", detalhes: stderr });
      }
      processarFila();
      return;
    }

    // ✅ Corrige bug do áudio: busca o arquivo gerado dinamicamente
    let arquivoFinal = filepath;
    if (tipo === "audio") {
      const base = filepath.replace(/\.[^.]+$/, "");
      const possiveis = [".mp3", ".m4a", ".opus", ".webm"].map(ext => base + ext);
      arquivoFinal = possiveis.find(f => fs.existsSync(f)) || filepath;
    }

    if (!fs.existsSync(arquivoFinal)) {
      try {
        res.status(500).json({ error: "Arquivo não encontrado após download." });
      } catch {}
      processarFila();
      return;
    }

    console.log(`✅ Concluído: ${path.basename(arquivoFinal)}`);

    res.download(arquivoFinal, filename, (err) => {
      if (err) console.error("Erro ao enviar:", err);
      fs.unlink(arquivoFinal, () => {});
    });

    processarFila();
  });
}

// ✅ Status
app.get("/", (req, res) => {
  res.json({
    status: "🟢 API rodando",
    uptime: process.uptime().toFixed(0) + "s",
    ffmpeg: ffmpegDisponivel() ? "✅ instalado" : "❌ não encontrado",
    fila_atual: fila.length,
    plataformas_suportadas: PLATAFORMAS
  });
});

// ✅ Baixa o vídeo
app.post("/download", autenticar, (req, res) => {
  const { url, qualidade } = req.body;
  if (!url) return res.status(400).json({ error: "Informe a URL do vídeo." });

  const temFFmpeg = ffmpegDisponivel();
  const filename = `video_${Date.now()}.mp4`;
  const filepath = path.join(DOWNLOAD_DIR, filename);

  let formato;
  if (temFFmpeg) {
    formato = qualidade
      ? `-f "bestvideo[height<=${qualidade}]+bestaudio/best[height<=${qualidade}]"`
      : `-f "bestvideo+bestaudio/best"`;
  } else {
    // Sem ffmpeg: baixa já em formato único
    formato = qualidade
      ? `-f "best[height<=${qualidade}]"`
      : `-f "best"`;
  }

  const comando = `yt-dlp ${formato} ${temFFmpeg ? "--merge-output-format mp4" : ""} -o "${filepath}" "${url}"`;

  console.log(`📥 Adicionado à fila: ${url}`);
  fila.push({ comando, filepath, filename, res, tipo: "video" });
  processarFila();
});

// ✅ Link direto
app.post("/link", autenticar, (req, res) => {
  const { url, qualidade } = req.body;
  if (!url) return res.status(400).json({ error: "Informe a URL do vídeo." });

  const formato = qualidade
    ? `-f "best[height<=${qualidade}]"`
    : `-f "best"`;

  const comando = `yt-dlp ${formato} -g "${url}"`;

  exec(comando, { timeout: 30000 }, (error, stdout, stderr) => {
    if (error) return res.status(500).json({ error: "Falha ao obter link.", detalhes: stderr });
    const links = stdout.trim().split("\n").filter(Boolean);
    res.json({ links });
  });
});

// ✅ Info do vídeo
app.post("/info", autenticar, (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "Informe a URL do vídeo." });

  const comando = `yt-dlp --dump-json --no-playlist "${url}"`;

  exec(comando, { timeout: 30000 }, (error, stdout, stderr) => {
    if (error) return res.status(500).json({ error: "Falha ao buscar info.", detalhes: stderr });

    try {
      const info = JSON.parse(stdout);
      res.json({
        titulo: info.title,
        duracao: info.duration_string,
        thumbnail: info.thumbnail,
        plataforma: info.extractor,
        uploader: info.uploader,
        qualidades_disponiveis: info.formats
          ? [...new Set(info.formats.map(f => f.height).filter(Boolean))].sort((a, b) => b - a)
          : []
      });
    } catch {
      res.status(500).json({ error: "Erro ao processar informações." });
    }
  });
});

// ✅ Áudio MP3
app.post("/audio", autenticar, (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "Informe a URL do vídeo." });

  const base = `audio_${Date.now()}`;
  const filepath = path.join(DOWNLOAD_DIR, base + ".mp3");

  const temFFmpeg = ffmpegDisponivel();
  const comando = temFFmpeg
    ? `yt-dlp -f bestaudio --extract-audio --audio-format mp3 -o "${filepath}" "${url}"`
    : `yt-dlp -f bestaudio -o "${path.join(DOWNLOAD_DIR, base + ".%(ext)s")}" "${url}"`;

  console.log(`🎵 Adicionado à fila (áudio): ${url}`);
  fila.push({ comando, filepath: path.join(DOWNLOAD_DIR, base), filename: base + ".mp3", res, tipo: "audio" });
  processarFila();
});

// ✅ Baixa foto (Pinterest e outros)
app.post("/foto", autenticar, (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "Informe a URL da foto." });

  const timestamp = Date.now();
  const cmd = `yt-dlp -o "${path.join(DOWNLOAD_DIR, `foto_${timestamp}.%(ext)s`)}" "${url}"`;

  // Pega título pra nomear o arquivo
  exec(`yt-dlp --get-title "${url}"`, { timeout: 30000 }, (err, stdout) => {
    let filename = `foto_${timestamp}.jpg`;
    if (!err && stdout.trim()) {
      const titulo = stdout.trim()
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/\s+/g, "_")
        .substring(0, 50);
      filename = `${titulo}.jpg`;
    }

    console.log(`🖼️ Baixando foto: ${url}`);

    exec(cmd, { timeout: 60000 }, (error, stdout, stderr) => {
      if (error) {
        console.error("❌ Erro foto:", stderr);
        if (!res.headersSent) res.status(500).json({ error: "Falha ao baixar foto.", detalhes: stderr });
        return;
      }

      const exts = [".jpg", ".jpeg", ".png", ".webp", ".gif"];
      const arquivoFinal = exts
        .map(e => path.join(DOWNLOAD_DIR, `foto_${timestamp}${e}`))
        .find(f => fs.existsSync(f));

      if (!arquivoFinal) {
        if (!res.headersSent) res.status(500).json({ error: "Arquivo não encontrado após download." });
        return;
      }

      console.log(`✅ Foto concluída: ${path.basename(arquivoFinal)}`);
      const nomeEnvio = filename.replace(/\.\w+$/, path.extname(arquivoFinal));
      res.download(arquivoFinal, nomeEnvio, (err) => {
        if (err) console.error("Erro ao enviar foto:", err);
        fs.unlink(arquivoFinal, () => {});
      });
    });
  });
});

// ✅ Busca e baixa foto do Pinterest por termo (via Google Images)
app.post("/pin", autenticar, async (req, res) => {
  const { termo } = req.body;
  if (!termo) return res.status(400).json({ error: "Informe o termo de busca." });

  try {
    const axios = require("axios");

    const query = `site:pinterest.com ${termo}`;
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=isch&num=20`;

    const { data: html } = await axios.get(url, {
      timeout: 15000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "pt-BR,pt;q=0.9",
      }
    });

    // Extrai todos os imgurl= da página
    const matches = [...html.matchAll(/imgurl=(https?[^&"]+)/g)];
    const imagens = matches
      .map(m => decodeURIComponent(m[1]))
      .filter(u => u.includes("pinimg.com"));

    if (imagens.length === 0) {
      return res.status(404).json({ error: "Nenhuma imagem encontrada para esse termo." });
    }

    // Sorteia uma imagem
    const imgUrl = imagens[Math.floor(Math.random() * imagens.length)];
    console.log(`🖼️ Pinterest via Google: ${imgUrl}`);

    const respImg = await axios.get(imgUrl, {
      responseType: "arraybuffer",
      timeout: 30000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://www.pinterest.com/"
      }
    });

    const ext = imgUrl.split(".").pop().split("?")[0] || "jpg";
    const filename = `${termo.replace(/\s+/g, "_")}_${Date.now()}.${ext}`;

    res.setHeader("Content-Type", respImg.headers["content-type"] || "image/jpeg");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(Buffer.from(respImg.data));

  } catch (err) {
    console.error("❌ Erro /pin:", err.message);
    res.status(500).json({ error: "Falha ao buscar imagem.", detalhes: err.message });
  }
});

// ✅ Inicia o servidor
app.listen(PORT, () => {
  const ffmpeg = ffmpegDisponivel();
  console.log("==============================");
  console.log(`🤖 API Universal de Downloads`);
  console.log(`🟢 Porta: ${PORT}`);
  console.log(`🔐 Autenticação: ativa`);
  console.log(`🎬 ffmpeg: ${ffmpeg ? "✅ instalado" : "⚠️ não encontrado (qualidade reduzida)"}`);
  console.log(`📥 POST /download  → Baixa o vídeo`);
  console.log(`🔗 POST /link      → Link direto`);
  console.log(`ℹ️  POST /info      → Info do vídeo`);
  console.log(`🎵 POST /audio     → Áudio MP3`);
  console.log(`🖼️  POST /foto      → Baixa foto`);
  console.log("==============================");
});

process.on("uncaughtException", (err) => console.error("⚠️ Erro:", err.message));
process.on("unhandledRejection", (reason) => console.error("⚠️ Rejeitada:", reason));
