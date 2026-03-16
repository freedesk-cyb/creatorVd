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
    } finally {
        // Cleanup session directory to save disk space
        try {
            if (fs.existsSync(sessionDir)) {
                fs.rmSync(sessionDir, { recursive: true, force: true });
                console.log(`Cleaned up session directory: ${taskId}`);
            }
        } catch (cleanupErr) {
            console.error('Error during cleanup:', cleanupErr);
        }
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
        const sessionDir = path.dirname(audioPath);
        const concatFilePath = path.join(sessionDir, 'concat_list.txt');
        
        // 1. Create the concat list file (The most memory-efficient way)
        // Note: FFmpeg concat demuxer requires the 'duration' after each 'file'
        // and repetitive duration for the last file is a common stability trick.
        let concatContent = '';
        imagePaths.forEach((img) => {
            // Use absolute paths and escape single quotes for FFmpeg safety
            const escapedPath = img.replace(/'/g, "'\\''");
            concatContent += `file '${escapedPath}'\nduration ${segmentDuration}\n`;
        });
        // Add the last file one more time without duration per FFmpeg spec
        const lastEscapedPath = imagePaths[imagePaths.length - 1].replace(/'/g, "'\\''");
        concatContent += `file '${lastEscapedPath}'\n`;

        fs.writeFileSync(concatFilePath, concatContent);
        console.log(`Created concat list: ${concatFilePath}`);

        const command = ffmpeg();

        // 2. Add inputs
        // -f concat: interprets the input as a list of files
        // -safe 0: allows absolute paths
        command.input(concatFilePath).inputOptions(['-f concat', '-safe 0']);
        command.input(audioPath);

        // 3. Simple filter for 720x1280 (Applies to the whole stream, low RAM)
        command
            .videoFilters([
                {
                    filter: 'scale',
                    options: '720:1280:force_original_aspect_ratio=increase'
                },
                {
                    filter: 'crop',
                    options: '720:1280'
                },
                {
                    filter: 'format',
                    options: 'yuv420p'
                }
            ])
            .videoCodec('libx264')
            .audioCodec('aac')
            .addOptions([
                '-preset ultrafast', 
                '-tune stillimage',
                '-shortest',
                '-y'
            ])
            .on('start', (cmd) => console.log('Executing FFmpeg Concat:', cmd))
            .on('progress', (progress) => {
                if (progress.percent) {
                    const totalProgress = 85 + (progress.percent * 0.13);
                    onProgress(`Ensamblando video... ${Math.round(progress.percent)}%`, totalProgress);
                } else if (progress.frames) {
                    onProgress(`Ensamblando video (procesando cuadros)...`, 88);
                }
            })
            .on('end', () => {
                console.log('FFmpeg completed successfully');
                resolve();
            })
            .on('error', (err, stdout, stderr) => {
                console.error('FFmpeg Error:', err.message);
                console.error('FFmpeg stderr:', stderr);
                reject(err);
            })
            .save(outputPath);
            
        // Timeout of 5 minutes for safety
        setTimeout(() => {
            reject(new Error('El ensamblado del video tardó demasiado (Timeout).'));
        }, 300000); 
    });
}

module.exports = { generateVideo };
