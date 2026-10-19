import { useState, useEffect } from 'react';
import { Bot, Sparkles, Zap, Lock, CreditCard, CheckCircle2, ArrowLeft, AlertCircle } from 'lucide-react';
import AdminPanel from './AdminPanel.jsx';


export default function App() {
  // Simple hash-based routing for Admin Panel
  const [currentHash, setCurrentHash] = useState(window.location.hash);
  useEffect(() => {
    const onHashChange = () => setCurrentHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);



  const [customerName, setCustomerName] = useState('');
  const [formUrl, setFormUrl] = useState('');
  const [urlError, setUrlError] = useState('');
  const [numberOfResponses, setNumberOfResponses] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [orderInfo, setOrderInfo] = useState(null);

  // Views: 'home' | 'success'
  const [view, setView] = useState('home');
  // Steps for 'home' view: 1 (Enter URL) -> 2 (Configure & Pay) | 'error' (Restricted form)
  const [step, setStep] = useState(1);

  // Track if they already clicked the WhatsApp button
  const [hasClickedWhatsApp, setHasClickedWhatsApp] = useState(false);

  const calculatePrice = (count) => {
    // Flat rate based on quantity band:
    //  1–25  → ₹10 each
    // 26–50  → ₹8 each
    // 51–75  → ₹6 each
    // 76–100 → ₹5 each
    let rate;
    if (count <= 25)       rate = 10;
    else if (count <= 50)  rate = 8;
    else if (count <= 75)  rate = 6;
    else                   rate = 5;
    return count * rate;
  };
  const price = calculatePrice(numberOfResponses).toFixed(2);

  const handleVerify = async (e) => {
    e.preventDefault();
    if (!formUrl) return;

    const isValidGoogleForm = /^https?:\/\/(docs\.google\.com\/forms\/|forms\.gle\/)/i.test(formUrl);
    if (!isValidGoogleForm) {
      setUrlError("Please enter a valid Google Form URL (e.g. https://forms.gle/...)");
      return;
    }

    setIsLoading(true);

    try {
      const checkRes = await fetch(`${import.meta.env.VITE_BACKEND_URL}/check-form`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-secret': import.meta.env.VITE_API_SECRET },
        body: JSON.stringify({ formUrl })
      });
      const checkData = await checkRes.json();

      if (checkData.error) {
        setUrlError(checkData.error);
      } else if (checkData.requiresLogin) {
        setStep('error');
      } else {
        setStep(2);
      }
    } catch (err) {
      console.error(err);
      alert('Network error verifying form.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCheckout = async (e) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // 0. Check if form is accessible
      const checkRes = await fetch(`${import.meta.env.VITE_BACKEND_URL}/check-form`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-secret': import.meta.env.VITE_API_SECRET },
        body: JSON.stringify({ formUrl })
      });
      const checkData = await checkRes.json();

      if (checkData.requiresLogin) {
        alert('Error: This Google Form requires users to be signed into a Google Account. Our AI cannot process restricted forms. Please make the form public.');
        setIsLoading(false);
        return;
      }

      // 1. Create order on backend (MongoDB)
      const orderRes = await fetch(`${import.meta.env.VITE_BACKEND_URL}/create-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-secret': import.meta.env.VITE_API_SECRET },
        body: JSON.stringify({ customerName, formUrl, numberOfResponses })
      });
      const orderData = await orderRes.json();

      if (orderData.error) {
        alert(`Error: ${orderData.error}`);
        setIsLoading(false);
        return;
      }

      // 2. Set order info and show success screen for WhatsApp payment
      setOrderInfo(orderData);
      setView('success');
      setHasClickedWhatsApp(false); // Reset WhatsApp click state

    } catch (err) {
      console.error(err);
      alert('Failed to initiate checkout. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  if (view === 'success' && orderInfo) {
    const whatsappMessage = encodeURIComponent(`Hi! I am ${customerName}.\nI want to pay for order #${orderInfo.id}.\n\nAmount: ₹${orderInfo.amount}\n\nHere is my payment screenshot:`);
    const whatsappUrl = `https://wa.me/919404602679?text=${whatsappMessage}`;

    return (
      <div className="min-h-screen flex items-center justify-center p-4 py-12">
        <div className="glass-panel p-6 md:p-12 rounded-3xl max-w-lg w-full text-center space-y-6">
          <div className="w-20 h-20 bg-green-500/20 text-green-400 rounded-full flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 size={40} />
          </div>
          <h2 className="text-3xl font-bold">Order Created!</h2>
          <p className="text-slate-300">
            Your order <strong className="text-white">#{orderInfo.id}</strong> for {numberOfResponses} responses has been created.
          </p>
          <div className="p-6 bg-black/30 rounded-xl border border-white/10 mt-4">
            <p className="text-sm text-slate-400 mb-2">Total Amount to Pay</p>
            <p className="text-5xl font-bold text-white mb-6">₹{orderInfo.amount}</p>

            <div className="bg-white p-4 rounded-xl inline-block">
              <img
                src="/qr.jpg"
                alt="UPI QR Code"
                className="w-48 h-48 object-contain mx-auto rounded-lg"
                onError={(e) => {
                  e.target.onerror = null;
                  e.target.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=upi://pay?pa=shubhamdhokare01@okaxis&pn=Shubham%20Dhokare&am=${orderInfo.amount}&cu=INR`;
                }}
              />
            </div>
            <p className="text-slate-300 text-sm mt-3 font-medium">UPI ID: <span className="text-white font-mono">shubhamdhokare01@okaxis</span></p>
          </div>

          <div className="text-sm text-slate-300">
            Scan the QR code to pay ₹{orderInfo.amount}, then send us the screenshot via WhatsApp.
          </div>
          <button
            onClick={() => {
              if (hasClickedWhatsApp) {
                alert("Order already placed! Please wait for our confirmation via WhatsApp.");
              } else {
                setHasClickedWhatsApp(true);
                window.open(whatsappUrl, "_blank", "noopener,noreferrer");
              }
            }}
            className="mt-8 px-6 py-4 bg-[#25D366] hover:bg-[#20bd5a] text-white rounded-xl transition-all font-bold flex items-center justify-center gap-2 w-full"
          >
            I have paid & Send Screenshot
          </button>
          <button
            onClick={() => { setView('home'); setStep(1); setFormUrl(''); setOrderInfo(null); }}
            className="mt-4 text-sm text-slate-400 hover:text-white transition-colors"
          >
            Start Another Campaign
          </button>
        </div>
      </div>
    );
  }

  if (currentHash === '#/admin') {
    return <AdminPanel />;
  }

  return (
    <div className="min-h-screen p-4 py-8 md:py-12 flex flex-col md:flex-row items-center justify-center gap-8 md:gap-12 max-w-6xl mx-auto mt-4 md:mt-0">

      {/* Left side: Copy & Branding */}
      <div className="flex-1 space-y-8 text-center md:text-left">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-panel text-sm text-blue-300 font-medium">
          <Sparkles size={16} />
          <span>Instant Survey Responses</span>
        </div>

        <h1 className="text-3xl sm:text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight">
          The ultimate solution for <br />
          <span className="gradient-text">empty surveys.</span>
        </h1>

        <p className="text-lg md:text-xl text-slate-400 max-w-lg mx-auto md:mx-0 px-2 md:px-0">
          Stop struggling to collect data. We deliver high-quality, perfectly balanced survey responses instantly so you can focus on your research, not your response count.
        </p>

        <div className="flex flex-col gap-4 text-sm text-slate-300 w-fit mx-auto md:mx-0 text-left">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500/20 text-blue-400 rounded-lg"><Bot size={18} /></div>
            <span>Diverse & Realistic Profiles (Perfectly mixed answers)</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-500/20 text-purple-400 rounded-lg"><Zap size={18} /></div>
            <span>Blazing Fast Delivery (Ready in minutes)</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg"><Lock size={18} /></div>
            <span>100% Authentic (Guaranteed organic, high-quality data)</span>
          </div>
        </div>
      </div>

      {/* Right side: Input panels */}
      <div className="flex-1 w-full max-w-md">
        <div className="glass-panel p-6 md:p-8 rounded-3xl relative transition-all duration-300">

          {step === 1 && (
            <form onSubmit={handleVerify} className="space-y-6">
              <div className="space-y-2">
                <div className="flex items-center gap-2 ml-1 relative">
                  <label className="text-sm font-medium text-slate-300">Google Form URL</label>
                  <div className="group flex items-center">
                    <AlertCircle className="text-yellow-500 cursor-help hover:text-yellow-400 transition-colors" size={16} />
                    <div className="absolute -left-2 md:left-0 bottom-full mb-2 w-56 md:w-64 p-3 bg-slate-800 border border-slate-700 rounded-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 shadow-xl pointer-events-none">
                      <p className="text-xs text-slate-300 leading-relaxed font-normal">
                        <strong>Unsupported Questions:</strong><br />Our Automation does <em>not</em> support <strong>File Upload</strong> or <strong>Grid</strong> questions. Please ensure they are optional or remove them before proceeding.
                      </p>
                      <div className="absolute left-4 md:left-32 -bottom-1.5 w-3 h-3 bg-slate-800 border-b border-r border-slate-700 rotate-45"></div>
                    </div>
                  </div>
                </div>
                <input
                  type="url"
                  required
                  placeholder="https://forms.gle/..."
                  value={formUrl}
                  onChange={(e) => {
                    setFormUrl(e.target.value);
                    setUrlError('');
                  }}
                  className={`w-full bg-black/40 border rounded-xl px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 transition-all ${urlError ? 'border-red-500 focus:ring-red-500' : 'border-white/10 focus:ring-blue-500'
                    }`}
                />
                {urlError ? (
                  <p className="text-sm text-red-400 mt-2 ml-1 flex items-center gap-1">
                    <AlertCircle size={14} /> {urlError}
                  </p>
                ) : (
                  <p className="text-xs text-slate-500 mt-2 ml-1">Must be a public form with login restrictions disabled.</p>
                )}
              </div>



              <button
                type="submit"
                disabled={isLoading || !formUrl}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-4 rounded-xl font-semibold transition-all mt-4"
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  'Verify Form URL'
                )}
              </button>
            </form>
          )}

          {step === 2 && (
            <form onSubmit={handleCheckout} className="space-y-6">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors mb-4"
              >
                <ArrowLeft size={16} /> Back
              </button>

              <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-xl flex items-start gap-3">
                <CheckCircle2 className="text-green-400 shrink-0 mt-0.5" size={18} />
                <p className="text-sm text-green-300">Form verified successfully! It is accessible for AI processing.</p>
              </div>

              <div className="space-y-4 mt-6">
                <div className="space-y-2 text-left">
                  <label className="text-sm font-medium text-slate-300 ml-1">Your Name</label>
                  <input
                    type="text"
                    required
                    placeholder="Enter your name"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  />
                </div>

                <div className="flex justify-between items-center ml-1 pt-2">
                  <label className="text-sm font-medium text-slate-300">Target Responses</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={numberOfResponses || ''}
                    onChange={(e) => {
                      let val = parseInt(e.target.value);
                      if (isNaN(val)) {
                        setNumberOfResponses(0);
                        return;
                      }
                      if (val > 100) val = 100;
                      setNumberOfResponses(val);
                    }}
                    onBlur={() => {
                      if (numberOfResponses < 1) setNumberOfResponses(1);
                    }}
                    className="w-24 bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-white font-bold text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Preset quick-select buttons */}
                <div className="flex gap-2 mt-3">
                  {[25, 50, 75, 100].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setNumberOfResponses(preset)}
                      className={`flex-1 py-1.5 rounded-lg text-sm font-semibold border transition-all ${
                        numberOfResponses === preset
                          ? 'bg-blue-600 border-blue-500 text-white'
                          : 'bg-black/30 border-white/10 text-slate-400 hover:border-blue-500/50 hover:text-white'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>

                <div>
                  <input
                    type="range"
                    min="1"
                    max="100"
                    value={numberOfResponses}
                    onChange={(e) => setNumberOfResponses(parseInt(e.target.value) || 1)}
                    className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                  <div className="flex justify-between text-xs text-slate-500 mt-2">
                    <span>1</span>
                    <span>100</span>
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-white/10 mt-6">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-slate-400">Total Price</span>
                  <span className="text-3xl font-bold">₹{price}</span>
                </div>
                <div className="text-xs text-slate-500 text-right mb-6">
                  {numberOfResponses} response{numberOfResponses !== 1 ? 's' : ''} &times; ₹{
                    numberOfResponses <= 25 ? 10
                    : numberOfResponses <= 50 ? 8
                    : numberOfResponses <= 75 ? 6
                    : 5
                  }/each
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#20bd5a] disabled:opacity-50 text-white px-6 py-4 rounded-xl font-bold transition-all"
                >
                  {isLoading ? (
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    'Proceed to WhatsApp'
                  )}
                </button>
              </div>
            </form>
          )}

          {step === 'error' && (
            <div className="space-y-6">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors mb-4"
              >
                <ArrowLeft size={16} /> Try another URL
              </button>

              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3">
                <AlertCircle className="text-red-400 shrink-0 mt-0.5" size={20} />
                <div>
                  <h3 className="text-red-300 font-semibold mb-1">Form is Restricted</h3>
                  <p className="text-sm text-red-200/80">
                    We cannot process this form because it requires users to sign in. Please disable "Collect verified emails" and "Require Sign-in" in your Google Form settings.
                  </p>
                </div>
              </div>

              <div className="mt-4">
                <h4 className="text-sm font-medium text-slate-300 mb-3">How to disable restrictions:</h4>
                <ul className="list-disc list-inside text-xs text-slate-400 mb-4 space-y-1 ml-1">
                  <li>Open your Google Form and go to the <strong>Settings</strong> tab</li>
                  <li>Under <em>Responses</em>, turn off <strong>Collect verified emails</strong></li>
                  <li>Under <em>Responses</em>, turn off <strong>Limit to 1 response</strong> (Require Sign-in)</li>
                </ul>
                <div className="rounded-xl overflow-hidden border border-white/10 bg-black/50 aspect-video">
                  <video
                    src="/assets/tutorial.mov"
                    controls
                    muted
                    className="w-full h-full object-contain"
                  />
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
