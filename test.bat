curl -X POST http://127.0.0.1:11434/api/embeddings \
    -H "Content-Type: application/json" \
    -d '{
        "model": "mxbai-embed-large",
        "text": "This is a test query to generate embeddings."
    }'
