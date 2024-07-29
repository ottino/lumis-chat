const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const readlineSync = require('readline-sync');
const config = require('./config.json');

const db = new sqlite3.Database(config.databasePath);

const embeddings = [];
const memory = [];
const memoryLimit = config.memoryLimit;

// Función para calcular la similitud del coseno entre dos vectores
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

// Función para buscar el documento más relevante
function findMostRelevantDocument(queryEmbedding) {
    let bestMatch = null;
    let bestSimilarity = -Infinity;
    let bestContent = null; // Para almacenar el contenido original del mejor documento

    embeddings.forEach(entry => {
        const similarity = cosineSimilarity(queryEmbedding, entry.embedding);
        // console.log(`Documento: ${entry.document}, Similitud: ${similarity}`); // Imprimir similitud
        if (similarity > bestSimilarity) {
            bestSimilarity = similarity;
            bestMatch = entry.document;
            bestContent = entry.originalContent; // Guardar el contenido original del mejor documento
        }
    });

    return { document: bestMatch, originalContent: bestContent }; // Devolver también el contenido original
}

function loadEmbeddings() {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM file_info", (err, rows) => {
            if (err) {
                reject(err);
            } else {
                rows.forEach(row => {
                    if (config.showDocumentNames) {
                        console.log(`Cargando embedding para el documento: ${row.nombre}`); // Imprimir documento cargado
                    }
                    try {
                        const embedding = JSON.parse(row.embedding);
                        // Verificar la dimensión del embedding
                        if (Array.isArray(embedding) && embedding.length > 0) {
                            embeddings.push({
                                document: row.nombre,
                                embedding: embedding,
                                originalContent: row.original_content // Guardar también el contenido original
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
            model:model,
            prompt: query
        });
        
        // console.log(`Respuesta de la API para la consulta "${query}":`, response.data); // Imprimir respuesta completa de la API

        if (!response.data || !response.data.embedding || !Array.isArray(response.data.embedding)) {
            console.error('Error: La respuesta de la API no contiene un embedding válido.');
            return [];
        }

        const embedding = response.data.embedding;

        if (embedding.length === 0 || embedding.every(value => value === 0)) {
            console.error('Error: El embedding generado está vacío o contiene solo ceros.');
            return [];
        }

        // console.log(`Embedding generado para la consulta "${query}": ${embedding}`); // Imprimir embedding generado
        return embedding;
    } catch (error) {
        console.error('Error generating embedding:', error.response ? error.response.data : error.message);
        throw error;
    }
}


// Función para realizar una consulta
async function queryDocuments(query) {
    const queryEmbedding = await generateEmbedding('mxbai-embed-large', query);
    const { document: mostRelevantDocument, originalContent } = findMostRelevantDocument(queryEmbedding);
    console.log('***** Documento más relevante:', mostRelevantDocument);

    if (!mostRelevantDocument) {
        console.log('No se encontró un documento relevante.');
        return;
    }

    // Memorizar la consulta y la respuesta
    if (memory.length >= memoryLimit) {
        memory.shift(); // Eliminar el más antiguo si excede el límite
    }
    memory.push(mostRelevantDocument);

    try {
        // Enviar la consulta al modelo llama3 usando axios
        const response = await axios.post(config.modelServiceUrl, {
            model: config.model,
            prompt: `${query}\n${originalContent}`, // Usar el contenido original del documento más relevante
            temperature: config.temperature,
            // max_tokens: config.max_tokens,
            stream: config.stream
        });
        console.log('***** Respuesta del modelo:', response.data.response);
    } catch (error) {
        console.error('Error al enviar la consulta al modelo:', error.response ? error.response.data : error.message);
        throw error;
    }
}

// Función principal para manejar el prompt infinito
async function main() {
    await loadEmbeddings();
    console.log("Embeddings cargados correctamente.");

    while (true) {
        const query = readlineSync.question('Ingrese su consulta: ');
        await queryDocuments(query);
    }
}

// Ejecutar la función principal
main().catch(err => {
    console.error('Error en el servicio:', err);
});
