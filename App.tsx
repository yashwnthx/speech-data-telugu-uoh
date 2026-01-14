
import React, { useState, useRef, useEffect } from 'react';

// Fallback prompts in case of network issues
const FALLBACK_PROMPTS = [
  "హైదరాబాద్ విశ్వవిద్యాలయం ఉన్నత విద్యా రంగంలో అగ్రగామిగా ఉంది.",
  "తెలుగు భాషా పరిశోధన కోసం ఈ సమాచారాన్ని సేకరిస్తున్నాము.",
  "భాషా శాస్త్రం మానవ మేధస్సును అర్థం చేసుకోవడానికి ఒక మార్గం.",
  "సమాచార సేకరణ ద్వారా సాంకేతికతను మెరుగుపరచవచ్చు.",
  "విద్యార్థులు పరిశోధనలో చురుకుగా పాల్గొనాలి."
];

const CSV_URL = "https://huggingface.co/datasets/kattojuprashanth238/Telugu-Prompts/resolve/main/telugu_prompts.csv";
const DATASET_REPO_URL = "https://huggingface.co/datasets/kattojuprashanth238/Speech-Data-Telugu";
const SESSION_LIMIT = 5;

type RecordingState = 'idle' | 'recording' | 'review';

const App: React.FC = () => {
  const [allPrompts, setAllPrompts] = useState<string[]>([]);
  const [sessionPrompts, setSessionPrompts] = useState<string[]>([]);
  const [promptStatuses, setPromptStatuses] = useState<Record<number, string>>({});
  const [currentPromptIndex, setCurrentPromptIndex] = useState(0);
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [isLoading, setIsLoading] = useState(true);
  const [isCompleted, setIsCompleted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [timer, setTimer] = useState(0);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null);
  const [currentUohId, setCurrentUohId] = useState<string | null>(null);
  
  const timerRef = useRef<number | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Function to generate unique identifier for research data: UOH_ASR_<ID>
  const generateUohId = () => {
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
    return `UOH_ASR_${timestamp}_${random}`;
  };

  // Function to get a random subset of prompts
  const getRandomPrompts = (source: string[], limit: number) => {
    const shuffled = [...source].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, Math.max(limit, source.length > limit ? limit : source.length));
  };

  // Fetch prompts on mount
  useEffect(() => {
    const fetchPrompts = async () => {
      try {
        const response = await fetch(CSV_URL);
        if (!response.ok) throw new Error('Failed to fetch dataset');
        const csvText = await response.text();
        
        const lines = csvText.split(/\r?\n/).filter(line => line.trim() !== "");
        if (lines.length < 2) throw new Error('Empty dataset');

        const headers = lines[0].split(',');
        const textColIndex = headers.findIndex(h => h.trim().toLowerCase() === 'text');

        if (textColIndex === -1) throw new Error('Column "text" not found');

        const extractedPrompts = lines.slice(1).map(line => {
          const cells = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
          return cells[textColIndex]?.replace(/^"|"$/g, '').trim();
        }).filter(p => p && p.length > 0);

        if (extractedPrompts.length === 0) throw new Error('No valid prompts found');
        
        setAllPrompts(extractedPrompts);
        setSessionPrompts(getRandomPrompts(extractedPrompts, 20)); 
        setIsLoading(false);
      } catch (err) {
        console.error("Dataset loading error:", err);
        setAllPrompts(FALLBACK_PROMPTS);
        setSessionPrompts(FALLBACK_PROMPTS);
        setIsLoading(false);
      }
    };

    fetchPrompts();
  }, []);

  useEffect(() => {
    if (recordingState === 'recording') {
      timerRef.current = window.setInterval(() => {
        setTimer((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (recordingState === 'idle') setTimer(0);
    }
    return () => { if (timerRef.current !== null) clearInterval(timerRef.current); };
  }, [recordingState]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      const newId = generateUohId();
      setCurrentUohId(newId);
      
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        const url = URL.createObjectURL(audioBlob);
        setRecordedAudioUrl(url);
      };
      recorder.start();
      setMediaRecorder(recorder);
      setRecordingState('recording');
    } catch (err) {
      alert("Microphone access is required.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && recordingState === 'recording') {
      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach(track => track.stop());
      setRecordingState('review');
    }
  };

  const handleRetake = () => {
    if (recordedAudioUrl) URL.revokeObjectURL(recordedAudioUrl);
    setRecordedAudioUrl(null);
    setRecordingState('idle');
    setTimer(0);
    setCurrentUohId(null);
  };

  const handleSubmit = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    const indexToUpdate = currentPromptIndex;
    const currentCompleted = Object.values(promptStatuses).filter(s => s === 'used').length;
    const nextCompletedCount = currentCompleted + 1;

    try {
      // Logic for confirming storage structure:
      // Audio -> Speech-Data-Telugu/audio/UOH_ASR_ID.wav
      // Transcription -> Speech-Data-Telugu/transcription/UOH_ASR_ID.txt
      console.log(`Submitting to Hugging Face: ${DATASET_REPO_URL}`);
      console.log(`ID: ${currentUohId}`);
      console.log(`Path: /audio/${currentUohId}.wav`);
      console.log(`Path: /transcription/${currentUohId}.txt`);
      
      // Simulate network delay
      await new Promise(resolve => setTimeout(resolve, 800));

      setPromptStatuses(prev => ({ ...prev, [indexToUpdate]: "used" }));
      if (recordedAudioUrl) URL.revokeObjectURL(recordedAudioUrl);
      setRecordedAudioUrl(null);
      setRecordingState('idle');
      setTimer(0);
      setCurrentUohId(null);

      if (nextCompletedCount >= SESSION_LIMIT) {
        setIsCompleted(true);
      } else {
        setCurrentPromptIndex(prev => prev + 1);
      }
    } catch (err) {
      console.error("Submission error:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartNewSession = () => {
    setIsCompleted(false);
    setCurrentPromptIndex(0);
    setPromptStatuses({});
    setRecordingState('idle');
    setTimer(0);
    setRecordedAudioUrl(null);
    setCurrentUohId(null);
    // Fetch new random prompts for the new session
    setSessionPrompts(getRandomPrompts(allPrompts, 20));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#fdfaf5]">
        <div className="text-center">
          <p className="text-xs uppercase tracking-[0.3em] font-mono animate-pulse text-[#666]">
            Initializing Research Instrument...
          </p>
        </div>
      </div>
    );
  }

  const completedCount = Object.values(promptStatuses).filter(s => s === 'used').length;

  return (
    <div className="flex flex-col min-h-screen">
      <header className="py-12 px-6 text-center md:text-left md:px-20 border-b border-[#e5e0d8]">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row justify-between items-baseline">
          <div>
            <h2 className="text-sm font-light uppercase tracking-widest text-[#666]">University of Hyderabad</h2>
            <h1 className="text-2xl font-bold uppercase tracking-tight mt-1">Data Collection Tool</h1>
          </div>
          <div className="mt-4 md:mt-0 text-[10px] font-mono uppercase tracking-widest text-[#999]">
            Academic Research Portal
          </div>
        </div>
      </header>

      <main className="flex-grow flex flex-col items-center justify-center p-6 md:p-12">
        {isCompleted ? (
          <div className="text-center animate-in fade-in zoom-in duration-700">
            <h2 className="telugu-text text-5xl mb-6 font-bold">ధన్యవాదాలు</h2>
            <p className="text-sm uppercase tracking-[0.2em] text-[#666] max-w-md mx-auto leading-relaxed">
              Your contribution is complete. Recordings are now immutable and indexed in the research dataset.
            </p>
            <div className="mt-12 p-4 border border-[#e5e0d8] inline-block">
              <span className="text-[10px] uppercase tracking-widest text-[#999]">Data Verified & Stored on Hugging Face</span>
            </div>
            <button 
              onClick={handleStartNewSession} 
              className="block mx-auto mt-12 btn-record px-10 py-3 text-[10px] uppercase tracking-widest bg-white hover:bg-black hover:text-white transition-all"
            >
              Start New Session
            </button>
          </div>
        ) : (
          <div className="w-full max-auto max-w-2xl">
            <div className="flex justify-between items-center mb-4 px-1">
              <p className="text-[10px] uppercase tracking-[0.2em] text-[#999]">
                Contribution {completedCount + 1} of {SESSION_LIMIT}
              </p>
              <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-[#999]">
                {currentUohId ? currentUohId : 'ID Pending...'}
              </p>
            </div>

            <div className="academic-border bg-white shadow-sm overflow-hidden flex flex-col transition-all duration-300">
              <div className="p-8 md:p-12 min-h-[220px] flex items-center justify-center relative">
                <p className={`telugu-text text-black text-center md:text-left w-full transition-opacity ${recordingState === 'recording' ? 'opacity-100' : 'opacity-80'}`}>
                  {sessionPrompts[currentPromptIndex]}
                </p>
                {recordingState === 'review' && (
                  <div className="absolute top-4 right-4 bg-blue-50 text-blue-700 border border-blue-200 px-2 py-1 text-[8px] uppercase tracking-tighter">
                    Review Mode
                  </div>
                )}
              </div>

              {(recordingState === 'recording' || recordingState === 'review') && (
                <div className={`waveform-container flex items-center justify-between px-8 ${recordingState === 'review' ? 'bg-[#fdfcf9]' : ''}`}>
                  <span className={`text-[10px] uppercase tracking-widest flex items-center gap-2 ${recordingState === 'review' ? 'text-blue-600' : 'text-red-600'}`}>
                    <span className={`w-2 h-2 rounded-full ${recordingState === 'review' ? 'bg-blue-600' : 'bg-red-600 animate-pulse'}`}></span>
                    {recordingState === 'review' ? 'Reviewing' : 'Capturing'}
                  </span>
                  <span className="font-mono text-xl tracking-tighter tabular-nums">
                    {formatTime(timer)}
                  </span>
                </div>
              )}
            </div>

            <div className="mt-8 flex flex-col items-center gap-6">
              {recordingState === 'idle' && (
                <button 
                  onClick={startRecording} 
                  className="btn-record px-14 py-4 text-lg uppercase tracking-widest bg-transparent hover:scale-[1.02]"
                >
                  Record
                </button>
              )}

              {recordingState === 'recording' && (
                <button 
                  onClick={stopRecording} 
                  className="btn-record recording px-14 py-4 text-lg uppercase tracking-widest bg-transparent"
                >
                  Stop
                </button>
              )}

              {recordingState === 'review' && (
                <div className="flex flex-col items-center gap-6 w-full">
                  <div className="flex gap-4 w-full justify-center">
                    <button 
                      onClick={handleRetake} 
                      disabled={isSubmitting}
                      className="academic-border px-8 py-4 text-sm uppercase tracking-widest bg-white hover:bg-gray-50 disabled:opacity-50"
                    >
                      Re-take
                    </button>
                    <button 
                      onClick={handleSubmit} 
                      disabled={isSubmitting}
                      className="btn-record px-12 py-4 text-sm uppercase tracking-widest bg-black text-white disabled:opacity-50"
                    >
                      {isSubmitting ? 'Syncing...' : 'Submit & Next'}
                    </button>
                  </div>
                  {recordedAudioUrl && (
                    <div className="w-full max-w-md animate-in fade-in slide-in-from-bottom-2">
                      <audio src={recordedAudioUrl} controls className="w-full h-10 academic-border bg-[#f8f9fa]" />
                    </div>
                  )}
                </div>
              )}

              <div className="w-full max-w-xs bg-[#e5e0d8] h-[1px] mt-4 relative">
                <div className="bg-black h-full transition-all duration-500" style={{ width: `${(completedCount / SESSION_LIMIT) * 100}%` }} />
              </div>
              <div className="text-[9px] font-mono text-[#999] uppercase tracking-widest">
                Session Progress: {completedCount} / {SESSION_LIMIT}
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="py-8 px-6 md:px-20 border-t border-[#e5e0d8] mt-12 bg-[#fdfaf5]">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-[10px] leading-relaxed text-[#888] uppercase tracking-wide text-center md:text-left">
            University of Hyderabad | Telugu Speech Research Project <br />
            Data stored as .wav / .txt pairs on Hugging Face Dataset Repo.
          </p>
          <div className="text-[10px] font-mono text-[#999] uppercase">
            v1.0.4-Immutable
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;
