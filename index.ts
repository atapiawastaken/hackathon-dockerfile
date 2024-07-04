import axios from 'axios';
import * as fs from 'fs';
import OpenAI from 'openai';
import * as dotenv from 'dotenv';

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

interface RepoDetails {
    name: string;
    description: string;
    url: string;
    readme: string;
}

interface RepoFile {
    name: string;
    path: string;
    sha: string;
    size: number;
    url: string;
    html_url: string;
    git_url: string;
    download_url: string;
    type: string;
    _links: {
        self: string;
        git: string;
        html: string;
    };
}

async function fetchRepoDetails(repoUrl: string): Promise<RepoDetails> {
    try {
        const repoPath = repoUrl.replace('https://github.com/', '');
        const apiUrl = `https://api.github.com/repos/${repoPath}`;
        const readmeUrl = `https://raw.githubusercontent.com/${repoPath}/main/README.md`;

        const [repoResponse, readmeResponse] = await Promise.all([
            axios.get(apiUrl, {
                headers: {
                    Authorization: `token ${GITHUB_TOKEN}`
                }
            }),
            axios.get(readmeUrl, {
                headers: {
                    Authorization: `token ${GITHUB_TOKEN}`
                }
            })
        ]);

        const repoData = repoResponse.data;
        const readmeData = readmeResponse.data;

        const repoDetails: RepoDetails = {
            name: repoData.name,
            description: repoData.description,
            url: repoData.html_url,
            readme: readmeData
        };

        return repoDetails;
    } catch (error) {
        console.error('Error fetching repository details:', (error as any).message);
        throw new Error('Failed to fetch repository details');
    }
}

async function listRepoFiles(repoUrl: string): Promise<{name: string, content: string}[]> {
    try {
        const repoPath = repoUrl.replace('https://github.com/', '');
        const apiUrl = `https://api.github.com/repos/${repoPath}/contents`;

        const response = await axios.get(apiUrl, {
            headers: {
                Authorization: `token ${GITHUB_TOKEN}`
            }
        });
        const files: RepoFile[] = response.data;

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

        return fileContents.filter(file => file !== null) as {name: string, content: string}[];
    } catch (error) {
        console.error('Error listing repository files:', (error as any).message);
        throw new Error('Failed to list repository files');
    }
}

async function generateDockerfile(repoDetails: RepoDetails, files: {name: string, content: string}[]): Promise<string> {
    const prompt = `Create a Dockerfile for a project with the following details:
    - Repository Name: ${repoDetails.name}
    - Description: ${repoDetails.description}
    - README Content: ${repoDetails.readme}
    - Files: ${files.map(file => `${file.name}: ${file.content.substring(0, 200)}`).join('\n')}

    Provide a complete and commented Dockerfile.`;

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
        console.error('Error generating Dockerfile:', (error as any).message);
        throw new Error('Failed to generate Dockerfile');
    }
}

async function writeDockerfile(dockerfile: string, filePath: string): Promise<void> {
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
    const repoUrl = 'https://github.com/facebook/react'; // Replace with any public repo URL
    try {
        const repoDetails = await fetchRepoDetails(repoUrl);
        const files = await listRepoFiles(repoUrl);
        const dockerfile = await generateDockerfile(repoDetails, files);
        console.log('Generated Dockerfile:', dockerfile);
        await writeDockerfile(dockerfile, './Dockerfile');
        console.log('Dockerfile has been written to disk.');
    } catch (error: any) {
        console.error('An error occurred:', error.message);
    }
}

main();