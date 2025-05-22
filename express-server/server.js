const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const FASTAPI_URL = process.env.FASTAPI_URL || 'http://fastapi-server:8000';

app.use(cors());
app.use(express.json({ charset: 'utf-8'}));
app.use(express.urlencoded({ extended: true, charset: 'utf-8' }));

const poolConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'rootpassword',
    database: process.env.DB_NAME || 'board_db',
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    acquireTimeout: 60000,
    timeout: 60000
};

let pool;

async function connectWithRetry(maxRetries = 10, retryDelay = 5000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`📡 데이터베이스 연결 시도 ${attempt}/${maxRetries}...`);
            
            pool = mysql.createPool(poolConfig);
            
            const [result] = await pool.execute('SELECT 1');
            console.log('✅ MySQL 연결 성공!');
            
            return true;
        } catch (error) {
            console.log(`❌ 연결 실패 (시도 ${attempt}/${maxRetries}):`, error.message);
            
            if (attempt === maxRetries) {
                console.error('💥 최대 재시도 횟수 초과. MySQL 연결 포기.');
                return false;
            }
            
            console.log(`⏰ ${retryDelay/1000}초 후 재시도...`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
    }
}

async function initializeDatabase() {
    try {
        console.log('🏗️  데이터베이스 테이블 초기화...');
        
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.execute(`
            CREATE TABLE IF NOT EXISTS posts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(200) NOT NULL,
                content TEXT NOT NULL,
                author_id INT NOT NULL,
                sentiment VARCHAR(20),
                sentiment_confidence DECIMAL(3,2),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        console.log('✅ 데이터베이스 테이블 초기화 완료');
        return true;
    } catch (error) {
        console.error('❌ 데이터베이스 초기화 실패:', error.message);
        return false;
    }
}

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: '토큰이 필요합니다' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: '유효하지 않은 토큰입니다' });
        }
        req.user = user;
        next();
    });
};

async function analyzeSentiment(text) {
    try {
        const response = await axios.post(`${FASTAPI_URL}/predict`, {
            text: text
        }, { timeout: 5000 });
        
        return {
            sentiment: response.data.prediction,
            confidence: response.data.confidence
        };
    } catch (error) {
        console.error('감정 분석 실패:', error.message);
        return {
            sentiment: '중성',
            confidence: 0.5
        };
    }
}

app.get('/', (req, res) => {
    res.json({ 
        message: '게시판 API 서버',
        status: 'running',
        database: pool ? 'connected' : 'disconnected',
        endpoints: {
            'POST /auth/register': '회원가입',
            'POST /auth/login': '로그인',
            'GET /posts': '게시글 목록',
            'POST /posts': '게시글 작성'
        }
    });
});

app.post('/auth/register', async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: '데이터베이스 연결이 없습니다' });
    }

    try {
        const { username, email, password } = req.body;
        
        if (!username || !email || !password) {
            return res.status(400).json({ error: '모든 필드를 입력해주세요' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const query = 'INSERT INTO users (username, email, password) VALUES (?, ?, ?)';
        const values = [username, email, hashedPassword];
        
        const [result] = await pool.execute(query, values);

        console.log('✅ 회원가입 성공:', username);
        res.status(201).json({ 
            message: '회원가입 성공',
            userId: result.insertId 
        });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            res.status(400).json({ error: '이미 존재하는 사용자명 또는 이메일입니다' });
        } else {
            console.error('회원가입 오류:', error);
            res.status(500).json({ error: '서버 오류' });
        }
    }
});

app.post('/auth/login', async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: '데이터베이스 연결이 없습니다' });
    }

    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ error: '사용자명과 비밀번호를 입력해주세요' });
        }

        const query = 'SELECT * FROM users WHERE username = ?';
        const [rows] = await pool.execute(query, [username]);

        if (rows.length === 0) {
            return res.status(401).json({ error: '존재하지 않는 사용자입니다' });
        }

        const user = rows[0];
        const validPassword = await bcrypt.compare(password, user.password);

        if (!validPassword) {
            return res.status(401).json({ error: '비밀번호가 일치하지 않습니다' });
        }

        const token = jwt.sign(
            { userId: user.id, username: user.username },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        console.log('✅ 로그인 성공:', username);
        res.json({
            message: '로그인 성공',
            token: token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email
            }
        });
    } catch (error) {
        console.error('로그인 오류:', error);
        res.status(500).json({ error: '서버 오류' });
    }
});

app.get('/posts', async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: '데이터베이스 연결이 없습니다' });
    }

    try {
        let page = 1;
        let limit = 10;
        
        if (req.query.page) {
            const parsedPage = parseInt(req.query.page);
            if (!isNaN(parsedPage) && parsedPage > 0) {
                page = parsedPage;
            }
        }
        
        if (req.query.limit) {
            const parsedLimit = parseInt(req.query.limit);
            if (!isNaN(parsedLimit) && parsedLimit > 0 && parsedLimit <= 100) {
                limit = parsedLimit;
            }
        }
        
        const offset = (page - 1) * limit;

        const [countResult] = await pool.execute('SELECT COUNT(*) as total FROM posts');
        const total = countResult[0].total;

        if (total === 0) {
            return res.json({
                posts: [],
                pagination: {
                    page,
                    limit,
                    total: 0,
                    totalPages: 0
                }
            });
        }

        const query = `
            SELECT p.id, p.title, p.content, p.sentiment, p.sentiment_confidence, 
                   p.created_at, p.updated_at, u.username as author
            FROM posts p
            JOIN users u ON p.author_id = u.id
            ORDER BY p.created_at DESC
            LIMIT ${limit} OFFSET ${offset}
        `;

        const [rows] = await pool.execute(query);

        console.log(`✅ 게시글 조회 성공: ${rows.length}개`);
        res.json({
            posts: rows,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('게시글 조회 오류:', error);
        res.status(500).json({ error: '서버 오류' });
    }
});

app.post('/posts', authenticateToken, async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: '데이터베이스 연결이 없습니다' });
    }

    try {
        const { title, content } = req.body;

        if (!title || !content) {
            return res.status(400).json({ error: '제목과 내용을 입력해주세요' });
        }

        const analysis = await analyzeSentiment(content);

        const query = 'INSERT INTO posts (title, content, author_id, sentiment, sentiment_confidence) VALUES (?, ?, ?, ?, ?)';
        const values = [title, content, req.user.userId, analysis.sentiment, analysis.confidence];
        
        const [result] = await pool.execute(query, values);

        console.log('✅ 게시글 작성 성공:', result.insertId);
        res.status(201).json({
            message: '게시글 작성 성공',
            postId: result.insertId,
            sentiment: analysis.sentiment,
            confidence: analysis.confidence
        });
    } catch (error) {
        console.error('게시글 작성 오류:', error);
        res.status(500).json({ error: '서버 오류' });
    }
});

app.get('/posts/:id', async (req, res) => {
    if (!pool) {
        return res.status(503).json({ error: '데이터베이스 연결이 없습니다' });
    }

    try {
        const postId = parseInt(req.params.id);

        if (isNaN(postId)) {
            return res.status(400).json({ error: '유효하지 않은 게시글 ID입니다' });
        }

        const query = `
            SELECT p.id, p.title, p.content, p.sentiment, p.sentiment_confidence,
                   p.created_at, p.updated_at, u.username as author, u.id as author_id
            FROM posts p
            JOIN users u ON p.author_id = u.id
            WHERE p.id = ?
        `;
        
        const [rows] = await pool.execute(query, [postId]);

        if (rows.length === 0) {
            return res.status(404).json({ error: '게시글을 찾을 수 없습니다' });
        }

        res.json(rows[0]);
    } catch (error) {
        console.error('게시글 상세 조회 오류:', error);
        res.status(500).json({ error: '서버 오류' });
    }
});

async function startServer() {
    console.log('🔄 서버 시작 중...');
    
    const dbConnected = await connectWithRetry();
    
    if (dbConnected) {
        const dbInitialized = await initializeDatabase();
        
        if (dbInitialized) {
            console.log('✅ 모든 초기화 완료');
        } else {
            console.log('⚠️  테이블 초기화 실패했지만 서버는 계속 실행');
        }
    } else {
        console.log('⚠️  데이터베이스 연결 실패했지만 서버는 계속 실행');
    }
    
    app.listen(PORT, () => {
        console.log(`🚀 Express 서버가 포트 ${PORT}에서 실행 중입니다`);
        console.log(`🤖 FastAPI URL: ${FASTAPI_URL}`);
        console.log(`📊 데이터베이스 상태: ${pool ? '연결됨' : '연결 안됨'}`);
    });
}

startServer().catch(error => {
    console.error('💥 서버 시작 실패:', error);
});