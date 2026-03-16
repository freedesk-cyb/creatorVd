const { HfInference } = require('@huggingface/inference');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const hf = new HfInference(process.env.HF_TOKEN);

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
        onProgress('Analyzing text and segments...', 10);
        // Split text by sentences or roughly by length
        const segments = text.split(/[.!?]+/).filter(s => s.trim().length > 0).map(s => s.trim());
        
        onProgress('Generating audio narration...', 20);
        const audioPath = path.join(sessionDir, 'narration.wav');
        
        // TTS using Hugging Face Router API (updated endpoint)
        console.log('Calling TTS API at router.huggingface.co...');
        const ttsResponse = await axios({
            url: `https://router.huggingface.co/models/${voiceModel || 'facebook/mms-tts-spa'}`,
            method: 'POST',
            headers: {
                Authorization: `Bearer ${process.env.HF_TOKEN}`,
                'Content-Type': 'application/json',
            },
            data: { inputs: text },
            responseType: 'arraybuffer',
        });
        
        fs.writeFileSync(audioPath, Buffer.from(ttsResponse.data));

        onProgress('Generating images for each scene...', 40);
        const imagePaths = [];
        for (let i = 0; i < segments.length; i++) {
            onProgress(`Generating image ${i + 1}/${segments.length}...`, 40 + (i / segments.length) * 30);
            const imgPath = path.join(sessionDir, `img_${i}.jpg`);
            
            console.log(`Calling Image API for segment ${i} at router.huggingface.co...`);
            const imgResponse = await axios({
                url: 'https://router.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0',
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${process.env.HF_TOKEN}`,
                    'Content-Type': 'application/json',
                },
                data: {
                    inputs: segments[i],
                    parameters: {
                        negative_prompt: 'blurry, low quality, distorted',
                        width: 1024,
                        height: 1024,
                    }
                },
                responseType: 'arraybuffer',
            });
            
            fs.writeFileSync(imgPath, Buffer.from(imgResponse.data));
            imagePaths.push(imgPath);
        }

        onProgress('Getting audio duration...', 75);
        const duration = await getAudioDuration(audioPath);
        const segmentDuration = duration / segments.length;

        onProgress('Assembling final video with FFmpeg...', 85);
        const outputFilename = `video_${taskId}.mp4`;
        const outputPath = path.join(OUTPUT_DIR, outputFilename);

        await assembleVideo(imagePaths, audioPath, outputPath, segmentDuration);

        onProgress('Cleaning up...', 95);
        // In a real app, you might keep the temp files for a bit, but for now we clean up
        // fs.rmSync(sessionDir, { recursive: true, force: true });

        onProgress('Video generation complete!', 100);
        return `/outputs/${outputFilename}`;

    } catch (error) {
        console.error('Error in generateVideo:', error);
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

        imagePaths.forEach((img, index) => {
            command.input(img).loop(segmentDuration);
        });

        command
            .input(audioPath)
            .complexFilter([
                // Scale and crop to 1080x1920 (Vertical 9:16)
                ...imagePaths.map((_, i) => ({
                    filter: 'scale',
                    options: '1080:1920:force_original_aspect_ratio=increase,crop=1080:1920',
                    inputs: i.toString(),
                    outputs: `v${i}`
                })),
                // Concatenate the video segments
                {
                    filter: 'concat',
                    options: { n: imagePaths.length, v: 1, a: 0 },
                    inputs: imagePaths.map((_, i) => `v${i}`),
                    outputs: 'vout'
                }
            ])
            .map('vout')
            .map('1:a') // Map the audio input (index 1 since images are 0 to N-1)
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
