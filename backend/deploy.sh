#!/bin/bash
echo "📦 Packaging Code and Dependencies separately..."

# Remove old zips
rm -f code.zip layer.zip

# 1. Package only the code (This will be tiny, < 1 MB)
echo "zipping code..."
zip -r code.zip . -x "*.git*" "*.env*" "*scratch*" "*test-*" "deploy.sh" "*.zip" "node_modules/*"
echo "✅ Created code.zip ($(du -k code.zip | cut -f1) KB)"

# 2. Package the dependencies for a Lambda Layer (Required format: nodejs/node_modules/...)
echo "zipping dependencies (this may take a minute)..."
mkdir -p nodejs
cp -r node_modules nodejs/
zip -rq layer.zip nodejs
rm -rf nodejs
echo "✅ Created layer.zip ($(du -m layer.zip | cut -f1) MB)"

echo ""
echo "🚀 NEW DEPLOYMENT WORKFLOW:"
echo "--- PART 1: The Layer (Do this only once) ---"
echo "1. Upload layer.zip to S3."
echo "2. Go to AWS Lambda Console -> Layers -> Create Layer."
echo "3. Upload from S3 (paste the S3 URI for layer.zip)."
echo "4. Choose Node.js 18.x / 20.x runtimes and Create."
echo "5. Go to your Lambda function -> scroll to bottom -> Add Layer -> Custom Layers -> Select your new layer."
echo ""
echo "--- PART 2: The Code (Do this anytime you change code) ---"
echo "1. Go to your Lambda Function -> Code tab."
echo "2. Upload from -> .zip file."
echo "3. Select code.zip (It's so small it will upload instantly in the browser!)."
