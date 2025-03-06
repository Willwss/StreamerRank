const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, 'config', '.env') });

console.log('Variáveis de ambiente carregadas:', {
    clientId: process.env.TWITCH_CLIENT_ID,
    clientSecret: process.env.TWITCH_CLIENT_SECRET?.substring(0, 5) + '...', // Mostra só o início do secret
    port: process.env.PORT,
    frontendUrl: process.env.FRONTEND_URL
});

const app = express();
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://127.0.0.1:5500';

const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3000/auth/callback';

app.use(cors({
    origin: FRONTEND_URL,
    credentials: true
}));
app.use(express.json());
app.use(express.static('../')); // Serve os arquivos estáticos do frontend

let userTokens = {}; // Simples armazenamento em memória para tokens
const participantes = new Map(); // Armazenamento temporário (substituir por banco de dados depois)
const raids = []; // Armazenamento temporário de raids

// Rota para redirecionar o usuário para login na Twitch
app.get('/auth/twitch', (req, res) => {
    const scope = 'user:read:email';  // Simplificado, removido user:read:follows
    const authUrl = `https://id.twitch.tv/oauth2/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=${scope}&force_verify=true`;
    res.redirect(authUrl);
});

// Callback da Twitch após login
app.get('/auth/callback', async (req, res) => {
    const code = req.query.code;
    
    console.log('Recebido código de autorização:', code?.substring(0, 5) + '...');
    
    if (!code) {
        return res.status(400).json({ error: 'Código de autorização não fornecido' });
    }

    try {
        // 1. Obter o token de acesso
        const tokenUrl = 'https://id.twitch.tv/oauth2/token';
        const tokenData = {
            client_id: CLIENT_ID,
            client_secret: CLIENT_SECRET,
            code: code,
            grant_type: 'authorization_code',
            redirect_uri: REDIRECT_URI
        };

        console.log('Enviando requisição para token...');
        
        const tokenResponse = await axios.post(tokenUrl, null, { 
            params: tokenData 
        }).catch(error => {
            console.error('Erro na requisição do token:', {
                status: error.response?.status,
                data: error.response?.data
            });
            throw error;
        });

        const accessToken = tokenResponse.data.access_token;

        if (!accessToken) {
            throw new Error('Token de acesso não recebido');
        }

        // 2. Obter dados do usuário
        const userResponse = await axios.get('https://api.twitch.tv/helix/users', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Client-Id': CLIENT_ID
            }
        });

        if (!userResponse.data.data || !userResponse.data.data[0]) {
            throw new Error('Dados do usuário não recebidos');
        }

        const userId = userResponse.data.data[0].id;
        userTokens[userId] = accessToken;
        
        console.log('Token salvo com sucesso:', {
            userId,
            tokenPrefix: accessToken.substring(0, 5) + '...'
        });

        // 3. Redirecionar para o frontend
        res.redirect(`${FRONTEND_URL}/pages/home/index.html?user=${userId}`);

    } catch (error) {
        console.error('Erro na autenticação:', {
            message: error.message,
            response: error.response?.data,
            stack: error.stack
        });
        
        res.status(500).json({
            error: 'Falha na autenticação',
            details: {
                message: error.message,
                response: error.response?.data
            }
        });
    }
});

// Rota para participar do ranking
app.post('/participar-ranking', (req, res) => {
    const { userId, participa } = req.body;
    
    if (!userId) {
        return res.status(400).json({ error: 'ID do usuário não fornecido' });
    }

    try {
        participantes.set(userId, { participa, dataInscricao: new Date() });
        res.json({ message: 'Participação no ranking confirmada!' });
    } catch (error) {
        console.error('Erro ao salvar participação:', error);
        res.status(500).json({ error: 'Erro ao salvar participação' });
    }
});

// Rota para receber webhooks da Twitch
app.post('/webhook', (req, res) => {
    const event = req.body;

    if (event.subscription?.type === 'channel.raid') {
        const { from_broadcaster_user_id, to_broadcaster_user_id, viewers } = event.event;
        
        // Salvar raid
        raids.push({
            de: from_broadcaster_user_id,
            para: to_broadcaster_user_id,
            espectadores: viewers,
            data: new Date()
        });

        console.log(`Raid registrada: ${from_broadcaster_user_id} -> ${to_broadcaster_user_id} (${viewers} viewers)`);
    }

    res.sendStatus(200);
});

// Rota para obter o ranking
app.get('/ranking', (req, res) => {
    try {
        // Calcular ranking baseado nos raids
        const ranking = Array.from(participantes.entries())
            .map(([userId, dados]) => {
                const raidsDoUsuario = raids.filter(raid => raid.de === userId);
                const totalEspectadores = raidsDoUsuario.reduce((sum, raid) => sum + raid.espectadores, 0);
                
                return {
                    userId,
                    nome: `Usuário ${userId}`, // Substituir por nome real depois
                    total_raids: raidsDoUsuario.length,
                    total_espectadores: totalEspectadores
                };
            })
            .sort((a, b) => b.total_espectadores - a.total_espectadores)
            .slice(0, 10);

        res.json(ranking);
    } catch (error) {
        console.error('Erro ao buscar ranking:', error);
        res.status(500).json({ error: 'Erro ao buscar ranking' });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
    console.log('Configurações:', {
        clientId: CLIENT_ID,
        redirectUri: REDIRECT_URI,
        frontendUrl: FRONTEND_URL
    });
}); 