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

    try {
        onProgress('Analizando texto y escenas...', 10);
        const segments = text.split(/[.!?]+/).filter(s => s.trim().length > 0).map(s => s.trim());
        
        onProgress('Generando audio (Google TTS)...', 20);
        const audioPath = path.join(sessionDir, 'narration.wav');
        
        // Get Google TTS URL (Unlimited for short texts, using simple getAudioUrl)
        const url = googleTTS.getAudioUrl(text, {
            lang: 'es',
            slow: false,
            host: 'https://translate.google.com',
        });

        const audioRes = await axios.get(url, { responseType: 'arraybuffer' });
        fs.writeFileSync(audioPath, Buffer.from(audioRes.data));

        onProgress('Generando imágenes (Pollinations.ai)...', 40);
        const imagePaths = [];
        
        for (let i = 0; i < segments.length; i++) {
            onProgress(`Generando escena ${i + 1}/${segments.length}...`, 40 + (i / segments.length) * 30);
            const imgPath = path.join(sessionDir, `img_${i}.jpg`);
            
            // Pollinations.ai URL-based generation
            const prompt = encodeURIComponent(segments[i] + ", high quality, 4k, vertical cinematic");
            const pollUrl = `https://pollinations.ai/p/${prompt}?width=1080&height=1920&seed=${Math.floor(Math.random() * 100000)}&model=flux&nologo=true`;
            
            console.log(`Downloading image from: ${pollUrl}`);
            const imgRes = await axios.get(pollUrl, { responseType: 'arraybuffer' });
            fs.writeFileSync(imgPath, Buffer.from(imgRes.data));
            imagePaths.push(imgPath);
        }

        onProgress('Calculando duración...', 75);
        const duration = await getAudioDuration(audioPath);
        const segmentDuration = duration / segments.length;

        onProgress('Ensamblando video final (FFmpeg)...', 85);
        const outputFilename = `video_${taskId}.mp4`;
        const outputPath = path.join(OUTPUT_DIR, outputFilename);

        await assembleVideo(imagePaths, audioPath, outputPath, segmentDuration);

        onProgress('¡Video completado con éxito!', 100);
        return `/outputs/${outputFilename}`;

    } catch (error) {
        console.error('Error en generateVideo:', error);
        throw error;
    }
}

function getAudioDuration(audioPath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(audioPath, (err, metadata) => {
            if (err) return reject(err);
            resolve(metadata.format.duration);
        });
    });
}

function assembleVideo(imagePaths, audioPath, outputPath, segmentDuration) {
    return new Promise((resolve, reject) => {
        const command = ffmpeg();

        imagePaths.forEach((img) => {
            command.input(img).loop(segmentDuration);
        });

        command
            .input(audioPath)
            .complexFilter([
                ...imagePaths.map((_, i) => ({
                    filter: 'scale',
                    options: '1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
                    inputs: i.toString(),
                    outputs: `v${i}`
                })),
                {
                    filter: 'concat',
                    options: { n: imagePaths.length, v: 1, a: 0 },
                    inputs: imagePaths.map((_, i) => `v${i}`),
                    outputs: 'vout'
                }
            ])
            .map('vout')
            .map(`${imagePaths.length}:a`) // Map audio from the last input
            .videoCodec('libx264')
            .audioCodec('aac')
            .outputOptions([
                '-pix_fmt yuv420p',
                '-shortest'
            ])
            .on('end', () => resolve())
            .on('error', (err) => reject(err))
            .save(outputPath);
    });
}

module.exports = { generateVideo };
