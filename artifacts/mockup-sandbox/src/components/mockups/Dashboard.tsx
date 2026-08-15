import React, { useEffect, useState } from "react";

interface DeviceMetrics {
  voltage: number | null;
  current: number | null;
  power: number | null;
  frequency: number | null;
  totalKwh: number | null;
}

interface DeviceStatus {
  isOn: boolean;
  deviceName: string;
  online: boolean;
  metrics: DeviceMetrics;
}

export default function Dashboard() {
  const [data, setData] = useState<DeviceStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const res = await fetch("http://localhost:5000/api/device/status");
      const json = await res.json();
      setData(json);
    } catch (err) {
      console.error("Errore nel recupero dati:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 3000); // Aggiorna ogni 3 secondi
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-500">
        Caricamento dati contatore...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8 text-center text-red-500">
        Impossibile connettersi al server API sulla porta 5000.
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto bg-white rounded-xl shadow-md space-y-4 my-8 font-sans">
      <div className="flex justify-between items-center border-b pb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-800">{data.deviceName}</h1>
          <span
            className={`inline-block px-2 py-1 text-xs rounded mt-1 ${data.online ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}
          >
            {data.online ? "Online" : "Offline"}
          </span>
        </div>
        <div className="text-right">
          <span className="text-sm text-gray-500">Stato Interruttore</span>
          <p
            className={`font-semibold ${data.isOn ? "text-green-600" : "text-gray-400"}`}
          >
            {data.isOn ? "ACCESO" : "SPENTO"}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 pt-2">
        <div className="p-4 bg-gray-50 rounded-lg">
          <p className="text-xs text-gray-500 uppercase font-semibold">
            Tensione
          </p>
          <p className="text-2xl font-bold text-gray-800">
            {data.metrics.voltage ?? "--"}{" "}
            <span className="text-sm font-normal">V</span>
          </p>
        </div>

        <div className="p-4 bg-gray-50 rounded-lg">
          <p className="text-xs text-gray-500 uppercase font-semibold">
            Frequenza
          </p>
          <p className="text-2xl font-bold text-gray-800">
            {data.metrics.frequency ?? "--"}{" "}
            <span className="text-sm font-normal">Hz</span>
          </p>
        </div>

        <div className="p-4 bg-gray-50 rounded-lg">
          <p className="text-xs text-gray-500 uppercase font-semibold">
            Potenza Assorbita
          </p>
          <p className="text-2xl font-bold text-gray-800">
            {data.metrics.power ?? 0}{" "}
            <span className="text-sm font-normal">W</span>
          </p>
        </div>

        <div className="rounded-xl border bg-card text-card-foreground shadow-sm p-6 mt-4">
          <div className="flex justify-between items-center mb-6">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              CONSUMI
            </span>
            <span className="text-xs font-medium text-muted-foreground bg-secondary/50 px-2 py-1 rounded">
              Totale
            </span>
          </div>

          <h3 className="text-2xl font-bold mb-4">Energia</h3>

          <div className="flex items-baseline space-x-2">
            {/* Qui usiamo la variabile dinamica che hai trovato nel tuo file! */}
            <span className="text-6xl font-black text-primary tracking-tighter">
              {data.metrics.totalKwh ?? "--"}
            </span>
            <span className="text-xl font-medium text-muted-foreground">
              kWh
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
