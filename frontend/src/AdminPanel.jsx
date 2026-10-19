import { useState, useEffect } from 'react';
import { Lock, RefreshCw, ArrowLeft, RotateCcw } from 'lucide-react';

export default function AdminPanel() {
  const [orders, setOrders] = useState([]);
  const [formStats, setFormStats] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    const savedAuth = localStorage.getItem('adminAuthExpiry');
    if (savedAuth && new Date().getTime() < parseInt(savedAuth, 10)) {
      return true;
    }
    return false;
  });
  const [passwordInput, setPasswordInput] = useState('');

  useEffect(() => {
    if (isAuthenticated) {
      fetchOrders();
      const interval = setInterval(() => fetchOrders(true), 15000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated]);

  const fetchOrders = async (silent = false) => {
    if (!silent) setIsRefreshing(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/admin/orders`, {
        headers: { 'x-api-secret': import.meta.env.VITE_API_SECRET }
      });
      const data = await res.json();
      const ordersList = Array.isArray(data) ? data : (data.orders || []);
      const fStats = data.formStats ? { ...data.formStats } : {};

      // Compute formStats if not returned by server
      if (Object.keys(fStats).length === 0) {
        for (const o of ordersList) {
          const url = o.formUrl;
          if (!url) continue;
          if (!fStats[url]) {
            fStats[url] = { totalCostINR: 0, totalRuns: 0 };
          }
          fStats[url].totalCostINR += (o.totalCostINR || 0);
          fStats[url].totalRuns += (o.runs?.length || (o.lastRun?.processed ? 1 : 0));
        }
      }

      const statusRank = { PENDING: 1, APPROVED: 2, COMPLETED: 3, REJECTED: 4 };
      ordersList.sort((a, b) => {
        const rankA = statusRank[a.status] || 99;
        const rankB = statusRank[b.status] || 99;
        if (rankA !== rankB) return rankA - rankB;
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      });

      setOrders(ordersList);
      setFormStats(fStats);
    } catch (err) {
      console.error("[Admin] Failed to fetch orders:", err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  const approveOrder = async (orderId) => {
    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/scrap`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-secret': import.meta.env.VITE_API_SECRET
        },
        body: JSON.stringify({ orderId })
      });
      const data = await res.json();
      if (data.success) {
        fetchOrders();
      } else {
        alert(data.error || "Failed to start scraping.");
      }
    } catch (err) {
      alert("Failed to approve order.");
    }
  };

  const rejectOrder = async (orderId) => {
    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-secret': import.meta.env.VITE_API_SECRET
        },
        body: JSON.stringify({ orderId })
      });
      const data = await res.json();
      if (data.success) {
        fetchOrders();
      } else {
        alert(data.error || "Failed to reject order.");
      }
    } catch (err) {
      alert("Failed to reject order.");
    }
  };

  const retryOrder = async (orderId) => {
    try {
      const res = await fetch(`${import.meta.env.VITE_BACKEND_URL}/retry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-secret': import.meta.env.VITE_API_SECRET
        },
        body: JSON.stringify({ orderId })
      });
      const data = await res.json();
      if (data.success) {
        fetchOrders();
      } else {
        alert(data.error || "Failed to retry order.");
      }
    } catch (err) {
      alert("Failed to retry order.");
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <form
          className="glass-panel p-8 rounded-3xl max-w-sm w-full text-center space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (passwordInput === import.meta.env.VITE_ADMIN_PASSWORD) {
              setIsAuthenticated(true);
              const expiry = new Date().getTime() + 24 * 60 * 60 * 1000;
              localStorage.setItem('adminAuthExpiry', expiry.toString());
            } else {
              alert("Incorrect Password");
            }
          }}
        >
          <Lock className="mx-auto text-blue-400 mb-2" size={40} />
          <h2 className="text-2xl font-bold text-white">Admin Login</h2>
          <input
            type="password"
            value={passwordInput}
            onChange={(e) => setPasswordInput(e.target.value)}
            placeholder="Enter Admin Password"
            className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-xl font-semibold transition-all cursor-pointer">
            Login
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-8 text-white max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Admin Panel - Orders</h1>
          <p className="text-xs text-slate-400 mt-1">Track requested, last run stats, total success & AI costs per form</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => fetchOrders()}
            disabled={isRefreshing}
            className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <RefreshCw size={12} className={isRefreshing ? "animate-spin" : ""} /> Refresh
          </button>
          <a href="#" className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-semibold flex items-center gap-1">
            <ArrowLeft size={12} /> Client Page
          </a>
        </div>
      </div>

      {/* Orders Table */}
      {isLoading ? (
        <p className="text-sm text-slate-400">Loading orders...</p>
      ) : (
        <div className="bg-white/10 rounded-xl overflow-x-auto border border-white/20">
          <table className="w-full text-left min-w-[950px] text-sm">
            <thead className="bg-black/60 text-xs text-slate-300 uppercase tracking-wider">
              <tr>
                <th className="p-4">Order ID / Customer</th>
                <th className="p-4">Amount</th>
                <th className="p-4">Requested</th>
                <th className="p-4">Last Run Stats</th>
                <th className="p-4">Total Progress</th>
                <th className="p-4">AI Cost Tally</th>
                <th className="p-4">Status</th>
                <th className="p-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {orders.map(o => {
                const requested = o.numberOfResponses || 0;
                const totalSucceeded = Math.min(o.successCount || 0, requested);
                const isFulfilled = totalSucceeded >= requested;
                const currentFailed = isFulfilled ? 0 : Math.min(o.failCount || 0, Math.max(0, requested - totalSucceeded));

                // Last run stats
                const lastRun = o.lastRun || {};
                const hasLastRun = (lastRun.processed || 0) > 0 || (o.runs && o.runs.length > 0);
                const lastRunProcessed = Math.min(lastRun.processed || 0, requested);
                const lastRunSuccess = Math.min(lastRun.successCount || 0, requested);
                const lastRunFailed = Math.min(lastRun.failCount || 0, requested);
                const lastRunCost = lastRun.costINR || 0;

                // Form cost tally
                const fStat = formStats[o.formUrl] || { totalCostINR: o.totalCostINR || 0 };
                const orderCost = o.totalCostINR || 0;
                const formTotalCost = fStat.totalCostINR || orderCost;

                return (
                  <tr key={o.orderId} className="bg-black/20 hover:bg-black/40 transition-colors">
                    {/* Order ID & Customer */}
                    <td className="p-4">
                      <div className="font-mono font-bold text-white text-xs">{o.orderId}</div>
                      <div className="text-slate-300 text-xs mt-0.5">{o.customerName || 'Unknown'}</div>
                      <a
                        href={o.formUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[11px] text-blue-400 hover:underline truncate max-w-[200px] block mt-0.5"
                        title={o.formUrl}
                      >
                        Form Link ↗
                      </a>
                    </td>

                    {/* Amount */}
                    <td className="p-4 font-semibold text-white">
                      ₹{o.amount}
                    </td>

                    {/* Requested */}
                    <td className="p-4 font-bold text-slate-200">
                      {requested}
                    </td>

                    {/* Last Run Stats */}
                    <td className="p-4">
                      {hasLastRun ? (
                        <div className="text-xs space-y-0.5">
                          <div className="text-slate-300 font-medium">
                            Processed: <span className="font-bold text-white">{lastRunProcessed}</span>
                          </div>
                          <div className="text-[11px]">
                            <span className="text-green-400 font-semibold">✅ {lastRunSuccess}</span>
                            <span className="text-slate-500 mx-1">/</span>
                            <span className={lastRunFailed > 0 ? "text-red-400 font-semibold" : "text-slate-400"}>❌ {lastRunFailed}</span>
                          </div>
                          <div className="text-purple-300 text-[11px] font-mono">
                            Cost: ₹{lastRunCost.toFixed(4)}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-500 text-xs italic">No run yet</span>
                      )}
                    </td>

                    {/* Total Progress */}
                    <td className="p-4">
                      <div className="text-xs space-y-0.5">
                        <div className="font-bold text-white">
                          {totalSucceeded} / {requested}
                        </div>
                        <div className="text-[11px] text-green-400 font-semibold">
                          ✅ {totalSucceeded} Succeeded
                        </div>
                        {currentFailed > 0 && (
                          <div className="text-[11px] text-red-400 font-semibold">
                            ❌ {currentFailed} Failed
                          </div>
                        )}
                      </div>
                    </td>

                    {/* AI Cost Tally */}
                    <td className="p-4">
                      <div className="text-xs space-y-0.5">
                        <div className="text-slate-300">
                          Order AI: <span className="font-mono font-bold text-purple-300">₹{orderCost.toFixed(4)}</span>
                        </div>
                        <div className="text-slate-400 text-[11px]">
                          Form Total: <span className="font-mono text-amber-300">₹{formTotalCost.toFixed(2)}</span>
                        </div>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="p-4">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                        o.status === 'COMPLETED' ? 'bg-purple-500/20 text-purple-400' :
                        o.status === 'APPROVED' ? 'bg-green-500/20 text-green-400' :
                        o.status === 'REJECTED' ? 'bg-red-500/20 text-red-400' :
                        'bg-yellow-500/20 text-yellow-400'
                      }`}>
                        {o.status}
                      </span>
                    </td>

                    {/* Action */}
                    <td className="p-4 text-center">
                      {o.status === 'PENDING' && (
                        <div className="flex gap-2 justify-center">
                          <button
                            onClick={() => approveOrder(o.orderId)}
                            className="px-3 py-1 bg-blue-600 hover:bg-blue-500 rounded text-xs font-semibold transition-all cursor-pointer"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => rejectOrder(o.orderId)}
                            className="px-2.5 py-1 bg-red-600/50 hover:bg-red-500/80 rounded text-xs font-semibold transition-all cursor-pointer"
                          >
                            Reject
                          </button>
                        </div>
                      )}

                      {o.status === 'APPROVED' && (
                        <span className="text-xs text-blue-400 animate-pulse font-semibold">Running...</span>
                      )}

                      {(o.status === 'COMPLETED' || o.status === 'APPROVED') && !isFulfilled && currentFailed > 0 && (
                        <button
                          onClick={() => retryOrder(o.orderId)}
                          className="px-3 py-1 bg-yellow-600 hover:bg-yellow-500 rounded text-xs font-semibold transition-all flex items-center gap-1 mx-auto cursor-pointer"
                        >
                          <RotateCcw size={12} /> Retry {currentFailed} Failed
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {orders.length === 0 && (
                <tr>
                  <td colSpan="8" className="p-6 text-center text-slate-400">No orders found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
