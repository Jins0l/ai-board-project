USE board_db;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_username (username),
    INDEX idx_email (email)
);

CREATE TABLE IF NOT EXISTS posts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    author_id INT NOT NULL,
    sentiment VARCHAR(20) DEFAULT 'neutral',
    sentiment_confidence FLOAT DEFAULT 0.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_author_id (author_id),
    INDEX idx_created_at (created_at),
    INDEX idx_sentiment (sentiment)
);

INSERT INTO users (username, email, password) VALUES 
('testuser', 'test@example.com', '$2b$10$K7L/VJEyWFYGZjQ4UIZ6H.VJKCGMkYTxvbKuWzE6HUH6nQqGjYXgm'),
('admin', 'admin@example.com', '$2b$10$K7L/VJEyWFYGZjQ4UIZ6H.VJKCGMkYTxvbKuWzE6HUH6nQqGjYXgm')
ON DUPLICATE KEY UPDATE username=username;

INSERT INTO posts (title, content, author_id, sentiment, sentiment_confidence) VALUES 
('환영합니다!', '좋은 하루 되세요!', 1, '긍정적', 0.85),
('공지사항', '게시판 이용 사항을 준수해 주세요.', 2, '중성', 0.45),
('오늘 날씨', '오늘 날씨가 정말 좋네요. 산책하기 딱 좋은 날입니다.', 1, '긍정적', 0.78)
ON DUPLICATE KEY UPDATE title=title;

CREATE INDEX idx_posts_sentiment_created ON posts(sentiment, created_at);
CREATE INDEX idx_posts_author_created ON posts(author_id, created_at);

SELECT 'Database initialization completed' as status;