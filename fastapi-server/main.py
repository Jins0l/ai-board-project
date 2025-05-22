from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict
import torch
import torch.nn as nn
import uvicorn

# FastAPI 앱 초기화
app = FastAPI(title="딥러닝 테스트 서버", version="1.0.0")

# 간단한 텍스트 분류 모델 (테스트용)
class SimpleTextClassifier(nn.Module):
    def __init__(self, vocab_size=1000, embed_dim=128, hidden_dim=64, num_classes=3):
        super().__init__()
        self.embedding = nn.Embedding(vocab_size, embed_dim)
        self.lstm = nn.LSTM(embed_dim, hidden_dim, batch_first=True)
        self.classifier = nn.Linear(hidden_dim, num_classes)
        self.softmax = nn.Softmax(dim=1)
    
    def forward(self, x):
        embedded = self.embedding(x)
        lstm_out, _ = self.lstm(embedded)
        last_output = lstm_out[:, -1, :]
        logits = self.classifier(last_output)
        return self.softmax(logits)

# 전역 변수
model = None
word_to_idx = {}

# Pydantic 모델들
class TextRequest(BaseModel):
    text: str

class PredictionResponse(BaseModel):
    prediction: str
    confidence: float
    probabilities: dict

class HealthResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())
    
    status: str
    model_loaded: bool

# 애플리케이션 시작 시 모델 로드
@app.on_event("startup")
async def load_model():
    global model, word_to_idx
    
    try:
        print("모델 로딩 시작...")
        # 간단한 단어 사전 생성
        common_words = [
            "좋다", "나쁘다", "보통", "최고", "최악", "괜찮다", "별로", "훌륭하다", 
            "멋지다", "끔찍하다", "안녕", "hello", "world", "python", "fastapi",
            "딥러닝", "머신러닝", "인공지능", "데이터", "분석", "예측", "모델"
        ]
        word_to_idx = {word: idx for idx, word in enumerate(common_words)}
        word_to_idx["<UNK>"] = len(word_to_idx)
        
        # 모델 초기화
        model = SimpleTextClassifier(vocab_size=len(word_to_idx))
        model.eval()
        print("✅ 모델이 성공적으로 로드되었습니다.")
        
    except Exception as e:
        print(f"❌ 모델 로드 실패: {e}")
        model = None

def text_to_tensor(text: str, max_length: int = 20):
    """텍스트를 텐서로 변환"""
    words = text.split()
    indices = []
    
    for word in words:
        if word in word_to_idx:
            indices.append(word_to_idx[word])
        else:
            indices.append(word_to_idx["<UNK>"])
    
    # 패딩 또는 자르기
    if len(indices) < max_length:
        indices.extend([0] * (max_length - len(indices)))
    else:
        indices = indices[:max_length]
    
    return torch.tensor([indices])

# API 엔드포인트들
@app.get("/", response_model=HealthResponse)
async def health_check():
    """헬스 체크 엔드포인트"""
    return HealthResponse(
        status="running", 
        model_loaded=model is not None
    )

@app.post("/predict", response_model=PredictionResponse)
async def predict_sentiment(request: TextRequest):
    """텍스트 감정 분석 예측"""
    if model is None:
        raise HTTPException(status_code=503, detail="모델이 로드되지 않았습니다")
    
    try:
        # 텍스트를 텐서로 변환
        input_tensor = text_to_tensor(request.text)
        
        # 예측 수행
        with torch.no_grad():
            predictions = model(input_tensor)
            probabilities = predictions[0].tolist()
        
        # 결과 해석
        labels = ["부정적", "중성", "긍정적"]
        max_idx = probabilities.index(max(probabilities))
        
        prediction_result = labels[max_idx]
        confidence = max(probabilities)
        
        prob_dict = {label: prob for label, prob in zip(labels, probabilities)}
        
        return PredictionResponse(
            prediction=prediction_result,
            confidence=round(confidence, 4),
            probabilities={k: round(v, 4) for k, v in prob_dict.items()}
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"예측 중 오류 발생: {str(e)}")

@app.get("/model/info")
async def get_model_info():
    """모델 정보 반환"""
    if model is None:
        raise HTTPException(status_code=503, detail="모델이 로드되지 않았습니다")
    
    return {
        "model_type": "SimpleTextClassifier",
        "vocab_size": len(word_to_idx),
        "parameters": sum(p.numel() for p in model.parameters()),
        "classes": ["부정적", "중성", "긍정적"]
    }

# 서버 실행 (개발용)
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)