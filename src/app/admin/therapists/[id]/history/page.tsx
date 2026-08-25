"use client";

import { useState, useEffect, use, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Calendar, Users, DollarSign, Clock, ArrowLeft, Activity, FileText, CheckCircle, Clock3, Award, ExternalLink } from "lucide-react";
import PageHeader from "@/components/layout/PageHeader";

type HistoryData = {
  id: string;
  visitDate: string;
  visitTime: string;
  status: string;
  patientName: string;
  serviceName: string;
  servicePrice: number;
  commissionAmount: number;
  commissionStatus: string;
};

function TherapistHistoryContent({ therapistId }: { therapistId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const paramStartDate = searchParams?.get("startDate");
  const paramEndDate = searchParams?.get("endDate");
  const paramMonth = searchParams?.get("month");
  const paramMode = searchParams?.get("filterMode") as "month" | "dateRange" | null;

  const [filterMode, setFilterMode] = useState<"month" | "dateRange">(() => {
    if (paramMode) return paramMode;
    if (paramStartDate && paramEndDate) return "dateRange";
    return "month";
  });

  const [month, setMonth] = useState(() => {
    if (paramMonth) return paramMonth;
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const [startDate, setStartDate] = useState(() => {
    if (paramStartDate) return paramStartDate;
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  });

  const [endDate, setEndDate] = useState(() => {
    if (paramEndDate) return paramEndDate;
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()).padStart(2, "0")}`;
  });

  const [data, setData] = useState<HistoryData[]>([]);
  const [therapist, setTherapist] = useState<any>(null);
  const [summary, setSummary] = useState({ totalTreatments: 0, totalCommissions: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchHistory = async () => {
      setLoading(true);
      setError("");
      try {
        const query =
          filterMode === "month"
            ? `month=${month}`
            : `startDate=${startDate}&endDate=${endDate}`;

        const res = await fetch(`/api/therapists/${therapistId}/history?${query}&_t=${Date.now()}`, {
          cache: "no-store",
          headers: { "Cache-Control": "no-cache" }
        });
        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || "Gagal mengambil riwayat pasien");
        }

        const json = await res.json();
        setData(json.data);
        setTherapist(json.therapist);
        setSummary(json.summary);
      } catch (err: any) {
        console.error(err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, [therapistId, startDate, endDate, month, filterMode]);

  const formatRupiah = (amount: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase bg-green-50 text-green-700 border border-green-200"><CheckCircle className="w-3 h-3" /> Selesai</span>;
      case "in_progress":
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase bg-blue-50 text-blue-700 border border-blue-200"><Clock3 className="w-3 h-3 animate-spin" /> Berjalan</span>;
      case "cancelled":
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase bg-red-50 text-red-700 border border-red-200">Batal</span>;
      default:
        return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase bg-gray-50 text-gray-700 border border-gray-200">{status}</span>;
    }
  };

  const getPeriodReadable = () => {
    if (filterMode === "month") {
      const [y, m] = month.split("-");
      return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
    }
    if (!startDate || !endDate) return "";
    const start = new Date(startDate).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
    const end = new Date(endDate).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
    return start === end ? start : `${start} - ${end}`;
  };

  const currentReportLink = `/admin/therapists/reports?filterMode=${filterMode}&startDate=${startDate}&endDate=${endDate}&month=${month}`;

  return (
    <div className="p-4 sm:p-6 lg:p-8 bg-gray-50/50 min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Navigation & Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <button 
            onClick={() => router.back()} 
            className="flex items-center gap-2 text-gray-600 hover:text-blue-600 transition-colors font-semibold text-sm bg-white px-4 py-2 rounded-xl border border-gray-200 shadow-sm w-fit"
          >
            <ArrowLeft className="w-4 h-4" /> Kembali
          </button>

          <Link
            href={currentReportLink}
            className="flex items-center gap-2 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors font-bold text-sm px-4 py-2 rounded-xl border border-indigo-200 shadow-sm"
          >
            <Award className="w-4 h-4 text-indigo-600" /> Buka Rapor & Slip Gaji Periode Ini
          </Link>
        </div>

        <PageHeader 
          title="Riwayat Penanganan Pasien"
          description={therapist ? `Transparansi tindakan & komisi untuk Terapis: ${therapist.name}` : "Memuat detail terapis..."}
          icon={FileText}
          rightContent={
            <div className="flex flex-col sm:flex-row items-center gap-3">
              {/* Filter Mode Selector */}
              <div className="flex items-center gap-1 bg-white rounded-xl border border-gray-200 p-1 shadow-sm">
                <button
                  onClick={() => setFilterMode("month")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${filterMode === "month" ? "bg-blue-50 text-blue-700 font-bold" : "text-gray-500 hover:text-gray-700"}`}
                >
                  Per Bulan
                </button>
                <button
                  onClick={() => setFilterMode("dateRange")}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${filterMode === "dateRange" ? "bg-blue-50 text-blue-700 font-bold" : "text-gray-500 hover:text-gray-700"}`}
                >
                  Rentang Tanggal
                </button>
              </div>

              {filterMode === "month" ? (
                <div className="relative bg-white rounded-xl border border-gray-200 shadow-sm px-3 py-1.5 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-gray-400 pointer-events-none" />
                  <input
                    type="month"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                    className="bg-transparent border-none focus:outline-none text-gray-900 font-semibold text-sm cursor-pointer"
                  />
                </div>
              ) : (
                <div className="flex items-center gap-2 bg-white border border-gray-200 shadow-sm rounded-xl px-2 py-1.5 focus-within:ring-2 focus-within:ring-blue-500/20 transition-all">
                  <Calendar className="w-4 h-4 text-gray-400 ml-2" />
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="bg-transparent border-none focus:outline-none text-gray-900 font-medium text-sm cursor-pointer"
                  />
                  <span className="text-gray-400 font-bold px-1">-</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="bg-transparent border-none focus:outline-none text-gray-900 font-medium text-sm cursor-pointer"
                  />
                </div>
              )}
            </div>
          }
        />

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl mb-6 font-semibold">
            {error}
          </div>
        )}

        {!loading && !error && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
              <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)] flex flex-col justify-between overflow-hidden relative group">
                <div className="absolute -right-4 -top-4 w-24 h-24 bg-blue-50 rounded-full group-hover:scale-150 transition-transform duration-500 ease-out z-0"></div>
                <div className="flex items-center gap-3 relative z-10 mb-2">
                  <div className="p-2.5 bg-blue-100 text-blue-600 rounded-xl">
                    <Users className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-gray-500 text-xs font-bold uppercase tracking-wider">Total Pasien Selesai</h3>
                    <p className="text-xs font-medium text-gray-400">Periode {getPeriodReadable()}</p>
                  </div>
                </div>
                <div className="mt-2 relative z-10">
                  <span className="text-3xl font-black text-gray-900">{summary.totalTreatments}</span>
                  <span className="text-gray-500 ml-2 font-medium">Pasien / Treatment</span>
                </div>
              </div>

              <div className="bg-gradient-to-br from-blue-600 to-indigo-600 p-5 rounded-2xl shadow-[0_4px_20px_-4px_rgba(59,130,246,0.4)] flex flex-col justify-between text-white relative overflow-hidden group">
                <div className="absolute right-0 bottom-0 w-32 h-32 bg-white/10 rounded-full -mr-10 -mb-10 group-hover:scale-125 transition-transform duration-500 ease-out z-0"></div>
                <div className="absolute left-10 top-2 w-16 h-16 bg-white/10 rounded-full group-hover:-translate-y-4 transition-transform duration-500 ease-out z-0"></div>
                
                <div className="flex items-center gap-3 relative z-10 mb-2">
                  <div className="p-2.5 bg-white/20 text-white rounded-xl backdrop-blur-sm border border-white/20">
                    <DollarSign className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-blue-100 text-xs font-bold uppercase tracking-wider">Total Komisi Tindakan</h3>
                    <p className="text-xs font-medium text-blue-100/80">Tersinkronisasi otomatis dengan slip gaji</p>
                  </div>
                </div>
                <div className="mt-2 relative z-10">
                  <span className="text-3xl font-black">{formatRupiah(summary.totalCommissions)}</span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
                <h3 className="font-bold text-gray-900 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-blue-600" />
                  Rincian Penanganan Pasien
                </h3>
                <div className="text-xs font-medium text-gray-500 bg-white px-3 py-1 rounded-lg border border-gray-200 shadow-sm">
                  Menampilkan {data.length} riwayat
                </div>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50/30 text-[11px] uppercase tracking-wider text-gray-500 border-b border-gray-100">
                      <th className="px-6 py-3 font-bold">Tanggal & Waktu</th>
                      <th className="px-6 py-3 font-bold">Nama Pasien</th>
                      <th className="px-6 py-3 font-bold">Layanan</th>
                      <th className="px-6 py-3 font-bold text-center">Status</th>
                      <th className="px-6 py-3 font-bold text-right">Komisi Didapat</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                          <div className="flex flex-col items-center justify-center">
                            <Clock className="w-10 h-10 text-gray-300 mb-3" />
                            <p className="font-medium text-gray-600">Belum ada pasien di periode ini</p>
                            <p className="text-sm mt-1">Data penanganan akan otomatis muncul setelah kunjungan selesai.</p>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      data.map((visit) => (
                        <tr key={visit.id} className="hover:bg-blue-50/30 transition-colors">
                          <td className="px-6 py-4">
                            <div className="font-semibold text-gray-900">
                              {new Date(visit.visitDate).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                            </div>
                            <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
                              <Clock className="w-3 h-3" /> {visit.visitTime}
                            </div>
                          </td>
                          <td className="px-6 py-4 font-bold text-gray-800">
                            {visit.patientName || "Pasien Tidak Diketahui"}
                          </td>
                          <td className="px-6 py-4">
                            <div className="font-medium text-gray-900">{visit.serviceName}</div>
                            <div className="text-xs text-gray-500 mt-0.5">{formatRupiah(visit.servicePrice)}</div>
                          </td>
                          <td className="px-6 py-4 text-center">
                            {getStatusBadge(visit.status)}
                          </td>
                          <td className="px-6 py-4 text-right">
                            {visit.commissionAmount > 0 ? (
                              <div className="font-black text-blue-600">+{formatRupiah(visit.commissionAmount)}</div>
                            ) : (
                              <div className="font-medium text-gray-400">-</div>
                            )}
                            {visit.commissionStatus === 'PENDING' && visit.commissionAmount > 0 && (
                              <div className="text-[10px] text-amber-500 font-bold mt-0.5 uppercase">Pending</div>
                            )}
                            {visit.commissionStatus === 'PAID' && visit.commissionAmount > 0 && (
                              <div className="text-[10px] text-green-500 font-bold mt-0.5 uppercase">Terbayar</div>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {loading && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="text-gray-500 font-medium">Memuat data histori pasien...</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TherapistHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const unwrappedParams = use(params);
  return (
    <Suspense
      fallback={
        <div className="p-8 flex items-center justify-center min-h-screen">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      }
    >
      <TherapistHistoryContent therapistId={unwrappedParams.id} />
    </Suspense>
  );
}
