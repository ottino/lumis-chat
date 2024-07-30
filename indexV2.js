const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const readlineSync = require('readline-sync');
const config = require('./config.json');


const db = new sqlite3.Database(config.databasePath);

const embeddings = [];
const memory = [];
const memoryLimit = config.memoryLimit;

function colorize(texto, colorCode) {
    return `\x1b[${colorCode}m${texto}\x1b[0m`;
  }
  

function cosineSimilarity(vecA, vecB) {
    if (vecA.length !== vecB.length) {
        console.error(`Error: Los vectores no tienen la misma dimensión. vecA: ${vecA.length}, vecB: ${vecB.length}`);
        return 0;
    }
    const dotProduct = vecA.reduce((sum, a, idx) => sum + a * vecB[idx], 0);
    const magnitudeA = Math.sqrt(vecA.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(vecB.reduce((sum, val) => sum + val * val, 0));
    return dotProduct / (magnitudeA * magnitudeB);
}

function findMostRelevantDocument(queryEmbedding, queryText) {
    let bestMatch = null;
    let bestSimilarity = -Infinity;
    let bestContent = null;

    embeddings.forEach(entry => {
        const contentSimilarity = cosineSimilarity(queryEmbedding, entry.embedding);
        const nameSimilarity = entry.document.toLowerCase().includes(queryText.toLowerCase()) ? 0.1 : 0;
        const totalSimilarity = contentSimilarity + nameSimilarity;

        if (totalSimilarity > bestSimilarity) {
            bestSimilarity = totalSimilarity;
            bestMatch = entry.document;
            bestContent = entry.originalContent;
        }
    });

    return { document: bestMatch, originalContent: bestContent, similarity: bestSimilarity };
}

function loadEmbeddings() {
    return new Promise((resolve, reject) => {
        db.all("SELECT nombre, embedding, original_content FROM file_info", (err, rows) => {
            if (err) {
                reject(err);
            } else {
                rows.forEach(row => {
                    if (config.showDocumentNames) {
                        console.log(`Cargando embedding para el documento: ${row.nombre}`);
                    }
                    try {
                        const embedding = JSON.parse(row.embedding);
                        if (Array.isArray(embedding) && embedding.length > 0) {
                            embeddings.push({
                                document: row.nombre,
                                embedding: embedding,
                                originalContent: row.original_content
                            });
                        } else {
                            console.error(`Error: El embedding para el documento ${row.nombre} no tiene dimensión.`);
                        }
                    } catch (error) {
                        console.error(`Error al parsear el embedding para el documento ${row.nombre}:`, error.message);
                    }
                });
                resolve();
            }
        });
    });
}

async function generateEmbedding(model, query) {
    try {
        const urlE = config.embeddingServiceUrl;
        const response = await axios.post(urlE, {
            model: model,
            prompt: query
        });
        
        if (!response.data || !response.data.embedding || !Array.isArray(response.data.embedding)) {
            console.error('Error: La respuesta de la API no contiene un embedding válido.');
            return [];
        }

        const embedding = response.data.embedding;

        if (embedding.length === 0 || embedding.every(value => value === 0)) {
            console.error('Error: El embedding generado está vacío o contiene solo ceros.');
            return [];
        }

        return embedding;
    } catch (error) {
        console.error('Error generating embedding:', error.response ? error.response.data : error.message);
        throw error;
    }
}

async function queryDocuments(query) {
    const queryEmbedding = await generateEmbedding('mxbai-embed-large', query);
    const { document: mostRelevantDocument, originalContent, similarity } = findMostRelevantDocument(queryEmbedding, query);
    console.log(colorize('***** Documento más relevante:',32), mostRelevantDocument);
    console.log(colorize('***** Similitud:',32), similarity);
    console.log(colorize('***** Contenido original del documento más relevante:',32), originalContent.substring(0, 200) + '...');

    if (!mostRelevantDocument || similarity < config.similarityThreshold) {
        console.log(colorize('No se encontró un documento relevante.',31));
        return;
    }

    if (memory.length >= memoryLimit) {
        memory.shift();
    }
    memory.push(mostRelevantDocument);

    try {
        const response = await axios.post(config.modelServiceUrl, {
            model: config.model,
            prompt: `Consulta: ${query}\nDocumento: ${mostRelevantDocument}\nContenido: ${originalContent}`,
            temperature: config.temperature,
            stream: config.stream
        });
        console.log(colorize('***** Respuesta del modelo:',34), response.data.response);
    } catch (error) {
        console.error('Error al enviar la consulta al modelo:', error.response ? error.response.data : error.message);
        throw error;
    }
}

async function main() {
    await loadEmbeddings();
    console.log("Embeddings cargados correctamente.");

    while (true) {
        const query = readlineSync.question('Ingrese su consulta: ');
        await queryDocuments(query);
    }
}

main().catch(err => {
    console.error('Error en el servicio:', err);
});