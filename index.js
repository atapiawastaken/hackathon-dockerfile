import axios from 'axios';
import fs from 'fs';
import { OpenAI } from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!OPENAI_API_KEY) {
    throw new Error('Missing OpenAI API key in environment variables');
}

if (!GITHUB_TOKEN) {
    throw new Error('Missing GitHub token in environment variables');
}

const openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
});

async function fetchRepoDetails(repoUrl, accessToken) {
    try {
        const response = await axios.get(repoUrl, {
            headers: {
                Authorization: `token ${accessToken}`
            }
        });
        return response.data;
    } catch (error) {
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            console.error('Error fetching repository details:', error.response.status);
            if (error.response.status === 404) {
                console.error('Repository not found. Please check the repository URL.');
            } else if (error.response.status === 403) {
                console.error('Access denied. Please check your access token and permissions.');
            } else {
                console.error('Unexpected error occurred:', error.response.statusText);
            }
        } else if (error.request) {
            // The request was made but no response was received
            console.error('No response received:', error.request);
        } else {
            // Something happened in setting up the request that triggered an Error
            console.error('Error setting up the request:', error.message);
        }
        throw new Error('Failed to fetch repository details');
    }
}

async function listRepoFiles(repoUrl) {
    try {
        const repoPath = repoUrl.replace('https://github.com/', '');
        const apiUrl = `https://api.github.com/repos/${repoPath}/contents`;

        const response = await axios.get(apiUrl, {
            headers: {
                Authorization: `token ${GITHUB_TOKEN}`
            }
        });
        const files = response.data;

        const fileContents = await Promise.all(files.map(async file => {
            if (file.type === 'file') {
                const fileContentResponse = await axios.get(file.download_url, {
                    headers: {
                        Authorization: `token ${GITHUB_TOKEN}`
                    }
                });
                const fileContent = fileContentResponse.data;
                return {
                    name: file.name,
                    content: typeof fileContent === 'string' ? fileContent : JSON.stringify(fileContent)
                };
            }
            return null;
        }));

        return fileContents.filter(file => file !== null);
    } catch (error) {
        console.error('Error listing repository files:', error.message);
        throw new Error('Failed to list repository files');
    }
}

async function generateDockerfile(repoDetails, files) {
    const prompt = `Create a Dockerfile for a project with the following details:
    - Repository Name: ${repoDetails.name}
    - Description: ${repoDetails.description}
    - README Content: ${repoDetails.readme}
    - Files: ${files.map(file => `${file.name}: ${file.content.substring(0, 200)}`).join('\n')}

    Provide a complete Dockerfile with no comments or explanations. Consider that what you return will be executed as Dockerfile.
    If you return any commments the Dockerfile will be wrong and will fail `;

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: 'You are a helpful assistant.' },
                { role: 'user', content: prompt }
            ],
        });

        if (response.choices && response.choices.length > 0 && response.choices[0].message) {
            const dockerfile = response.choices[0].message.content?.trim();
            if (dockerfile) {
                return dockerfile;
            } else {
                console.error('OpenAI API returned an empty message content.');
                throw new Error('OpenAI API returned an empty message content.');
            }
        } else {
            console.error('OpenAI API returned an empty response.');
            throw new Error('OpenAI API returned an empty response.');
        }
    } catch (error) {
        console.error('Error generating Dockerfile:', error.message);
        throw new Error('Failed to generate Dockerfile');
    }
}

async function writeDockerfile(dockerfile, filePath) {
    return new Promise((resolve, reject) => {
        fs.writeFile(filePath, dockerfile, (err) => {
            if (err) {
                console.error('Error writing Dockerfile to disk:', err.message);
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

async function main() {
    // const repoUrl = 'https://github.com/facebook/react'; // Replace with any public repo URL
    const repoUrl = 'https://github.com/mach1el/my-django'; // Replace with any public repo URL
    try {
        const repoDetails = await fetchRepoDetails(repoUrl);
        const files = await listRepoFiles(repoUrl);
        const dockerfile = await generateDockerfile(repoDetails, files);
        console.log('Generated Dockerfile:', dockerfile);
        await writeDockerfile(dockerfile, './Dockerfile');
        console.log('Dockerfile has been written to disk.');
    } catch (error) {
        console.error('An error occurred:', error.message);
    }
}

main();
