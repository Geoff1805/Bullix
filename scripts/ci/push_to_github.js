const fs = require('fs');
const path = require('path');

async function main() {
  const configFile = 'C:\\Users\\geoff\\.gemini\\config\\mcp_config.json';
  if (!fs.existsSync(configFile)) {
    console.error('Config MCP introuvable');
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  const auth = config.mcpServers['github-mcp-server'].headers.Authorization;
  const token = auth.replace(/^Bearer\s+/, '');

  const owner = 'Geoff1805';
  const repo = 'Bullix';
  const branch = 'main';
  const commitMessage = process.argv[2] || 'feat(web): nouveau design moderne collector pour le frontend Bullix';
  const cliFiles = process.argv.slice(3);
  const filesToPush = cliFiles.length > 0 ? cliFiles : [
    'web/index.html'
  ];

  console.log(`🚀 Publication de ${filesToPush.length} fichiers vers ${owner}/${repo} (${branch})...`);

  const headers = {
    'Authorization': `token ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'Bullix-Auto-Pusher/1.0',
    'Content-Type': 'application/json'
  };

  // 1. Récupérer le SHA du dernier commit sur 'main'
  const refRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`, { headers });
  if (!refRes.ok) {
    throw new Error(`Échec récupération ref: HTTP ${refRes.status} ${await refRes.text()}`);
  }
  const refData = await refRes.json();
  const latestCommitSha = refData.object.sha;
  console.log(`  -> Dernier commit distant : ${latestCommitSha}`);

  // 2. Récupérer le base tree SHA
  const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits/${latestCommitSha}`, { headers });
  if (!commitRes.ok) {
    throw new Error(`Échec récupération commit: HTTP ${commitRes.status}`);
  }
  const commitData = await commitRes.json();
  const baseTreeSha = commitData.tree.sha;

  // 3. Créer les blobs ou insérer dans l'arbre
  const treeItems = [];
  for (const fileRelPath of filesToPush) {
    const fullPath = path.resolve(process.cwd(), fileRelPath);
    if (!fs.existsSync(fullPath)) {
      console.warn(`  ⚠️ Fichier non trouvé localement: ${fileRelPath}`);
      continue;
    }
    const content = fs.readFileSync(fullPath, 'utf8');

    // Créer un blob pour éviter toute altération d'encodage
    const blobRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/blobs`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        content: Buffer.from(content).toString('base64'),
        encoding: 'base64'
      })
    });

    if (!blobRes.ok) {
      throw new Error(`Échec création blob pour ${fileRelPath}: ${await blobRes.text()}`);
    }
    const blobData = await blobRes.json();

    treeItems.push({
      path: fileRelPath.replace(/\\/g, '/'),
      mode: '100644',
      type: 'blob',
      sha: blobData.sha
    });
    console.log(`  -> Blob créé pour ${fileRelPath} (${blobData.sha.slice(0, 7)})`);
  }

  // 4. Créer le nouvel arbre Git
  const newTreeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: treeItems
    })
  });
  if (!newTreeRes.ok) {
    throw new Error(`Échec création arbre: ${await newTreeRes.text()}`);
  }
  const newTreeData = await newTreeRes.json();
  console.log(`  -> Arbre Git créé : ${newTreeData.sha}`);

  // 5. Créer le commit
  const newCommitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: commitMessage,
      tree: newTreeData.sha,
      parents: [latestCommitSha]
    })
  });
  if (!newCommitRes.ok) {
    throw new Error(`Échec création commit: ${await newCommitRes.text()}`);
  }
  const newCommitData = await newCommitRes.json();
  console.log(`  -> Commit créé : ${newCommitData.sha}`);

  // 6. Mettre à jour la branche 'main'
  const updateRefRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({
      sha: newCommitData.sha,
      force: false
    })
  });
  if (!updateRefRes.ok) {
    throw new Error(`Échec mise à jour ref: ${await updateRefRes.text()}`);
  }

  console.log(`\n🎉 Publication réussie ! Commit ${newCommitData.sha.slice(0, 7)} en ligne sur ${branch}.`);
}

main().catch(err => {
  console.error('❌ Erreur:', err.message);
  process.exit(1);
});
