import axios from 'axios';
import * as fs from 'fs';
import OpenAI from 'openai';
import * as dotenv from 'dotenv';

dotenv.config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!OPENAI_API_KEY) {
    throw new Error('Missing OpenAI API key in environment variables');
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
            axios.get(apiUrl),
            axios.get(readmeUrl)
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
        throw new Error('Failed to fetch repository details');
    }
}

async function listRepoFiles(repoUrl: string): Promise<{name: string, content: string}[]> {
    try {
        const repoPath = repoUrl.replace('https://github.com/', '');
        const apiUrl = `https://api.github.com/repos/${repoPath}/contents`;

        const response = await axios.get(apiUrl);
        const files: RepoFile[] = response.data;

        const fileContents = await Promise.all(files.map(async file => {
            if (file.type === 'file') {
                const fileContentResponse = await axios.get(file.git_url);
                const fileContentData = fileContentResponse.data;
                const fileContent = Buffer.from(fileContentData.content, 'base64').toString('utf-8');
                return {
                    name: file.name,
                    content: fileContent
                };
            }
            return null;
        }));

        return fileContents.filter(file => file !== null) as {name: string, content: string}[];
    } catch (error) {
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
        const response = await openai.completions.create({
            model: 'text-davinci-003',
            prompt: prompt,
            max_tokens: 150,
            temperature: 0.7,
        });

        const dockerfile = response.choices[0].text.trim();
        return dockerfile;
    } catch (error) {
        throw new Error('Failed to generate Dockerfile');
    }
}

async function writeDockerfile(dockerfile: string, filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        fs.writeFile(filePath, dockerfile, (err) => {
            if (err) {
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
        console.error(error.message);
    }
}

main();
