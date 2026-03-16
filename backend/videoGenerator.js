const googleTTS = require('google-tts-api');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

// Ensure temp directory exists
const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR);
}

// Ensure outputs directory exists
const OUTPUT_DIR = path.join(__dirname, 'public', 'outputs');
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function generateVideo(text, voiceModel, taskId, onProgress) {
    const sessionDir = path.join(TEMP_DIR, taskId);
    fs.mkdirSync(sessionDir);

    // Map voice selection to Google TTS language codes
    let lang = 'es';
    if (voiceModel === 'en') lang = 'en';
    if (voiceModel === 'pt') lang = 'pt';
    if (voiceModel === 'fr') lang = 'fr';
    if (voiceModel === 'it') lang = 'it';
    
    console.log(`Starting generation with language: ${lang}`);

    try {
        onProgress('Analizando texto y escenas...', 5);
        const segments = text.split(/[.!?]+/).filter(s => s.trim().length > 0).map(s => s.trim());

        onProgress(`Generando audio (${lang})...`, 20);
        const audioPath = path.join(sessionDir, 'narration.wav');
        
        // Support longer texts by splitting into chunks
        const results = googleTTS.getAllAudioUrls(text, {
            lang: lang,
            slow: false,
            host: 'https://translate.google.com',
            splitPunct: '.,!? ',
        });

        // Download and concat all audio buffers
        const audioBuffers = [];
        for (const res of results) {
            console.log(`Downloading audio chunk from Google...`);
            const audioChunk = await axios.get(res.url, { responseType: 'arraybuffer' });
            if (audioChunk.data) {
                audioBuffers.push(Buffer.from(audioChunk.data));
            }
        }
        
        const finalAudioBuffer = Buffer.concat(audioBuffers);
        console.log(`Audio generated. Total size: ${finalAudioBuffer.length} bytes`);
        
        if (finalAudioBuffer.length < 100) {
            throw new Error("El audio generado es demasiado pequeño o está corrupto.");
        }
        
        fs.writeFileSync(audioPath, finalAudioBuffer);

        onProgress('Generando imágenes (Pollinations.ai)...', 40);
        const imagePaths = [];
        
        for (let i = 0; i < segments.length; i++) {
            onProgress(`Generando escena ${i + 1}/${segments.length}...`, 40 + (i / segments.length) * 30);
            const imgPath = path.join(sessionDir, `img_${i}.jpg`);
            
            // Pollinations.ai URL-based generation
            // Optimized for low-RAM server: 720x1280 (HD Vertical)
            const prompt = encodeURIComponent(segments[i] + ", vertical cinematic style, highly detailed, vivid colors");
            const pollUrl = `https://pollinations.ai/p/${prompt}?width=720&height=1280&seed=${Math.floor(Math.random() * 100000)}&nologo=true`;
            
            console.log(`Requesting image ${i}: ${pollUrl}`);
            const imgRes = await axios.get(pollUrl, { responseType: 'arraybuffer' });
            fs.writeFileSync(imgPath, Buffer.from(imgRes.data));
            imagePaths.push(imgPath);
        }

        onProgress('Calculando duración...', 75);
        const duration = await getAudioDuration(audioPath);
        const segmentDuration = duration / segments.length;
        console.log(`Stats: Duration=${duration}s, SegDuration=${segmentDuration}s, Segments=${segments.length}`);

        onProgress('Ensamblando video final (FFmpeg)...', 85);
        const outputFilename = `video_${taskId}.mp4`;
        const outputPath = path.join(OUTPUT_DIR, outputFilename);

        await assembleVideo(imagePaths, audioPath, outputPath, segmentDuration);

        onProgress('¡Video completado con éxito!', 100);
        return `/outputs/${outputFilename}`;

    } catch (error) {
        console.error('Error detallado en generateVideo:', error);
        throw error;
    }
}

function getAudioDuration(audioPath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(audioPath, (err, metadata) => {
            if (err) return reject(new Error(`Fallo al analizar audio: ${err.message}`));
            resolve(metadata.format.duration || 1);
        });
    });
}

function assembleVideo(imagePaths, audioPath, outputPath, segmentDuration) {
    return new Promise((resolve, reject) => {
        const command = ffmpeg();

        // 1. Add images as loop inputs
        imagePaths.forEach((img) => {
            command.input(img).inputOptions(['-loop 1']).inputOptions([`-t ${segmentDuration}`]);
        });

        // 2. Add audio
        command.input(audioPath);

        const audioIndex = imagePaths.length;

        // 3. Optimized filter for 720x1280 (Vertical HD)
        const filterStr = [];
        imagePaths.forEach((_, i) => {
            filterStr.push(`[${i}:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,format=yuv420p[v${i}]`);
        });

        if (imagePaths.length > 1) {
            const videoInputs = imagePaths.map((_, i) => `[v${i}]`).join('');
            filterStr.push(`${videoInputs}concat=n=${imagePaths.length}:v=1:a=0[vout]`);
        } else {
            filterStr.push(`[v0]null[vout]`);
        }

        // Pass audio through filter graph to give it an explicit label
        // This is required when using complexFilter to avoid indexing confusion
        filterStr.push(`[${audioIndex}:a]anull[aout]`);

        command
            .complexFilter(filterStr.join('; '))
            .map('[vout]')
            .map('[aout]')
            .videoCodec('libx264')
            .audioCodec('aac')
            .addOptions([
                '-preset ultrafast', 
                '-tune stillimage',
                '-shortest',
                '-pix_fmt yuv420p',
                '-y'
            ])
            .on('start', (cmd) => console.log('Executing FFmpeg:', cmd))
            .on('end', () => resolve())
            .on('error', (err, stdout, stderr) => {
                console.error('FFmpeg Error:', err.message);
                console.error('FFmpeg stderr:', stderr);
                reject(err);
            })
            .save(outputPath);
    });
}

module.exports = { generateVideo };
