const fs = require('fs');
let c = fs.readFileSync('src/app/admin/layout.tsx', 'utf8');

c = c.replace(
  'import { LogOut, Menu, CalendarCheck, Users, Package, Wallet, Settings, X, Inbox, MapPin, TrendingUp, TrendingDown, Activity, ShieldCheck, ChevronDown, Store, Clock, Award, Receipt, FileText } from "lucide-react";',
  'import { LogOut, Menu, CalendarCheck, Users, Package, Wallet, Settings, X, Inbox, MapPin, TrendingUp, TrendingDown, Activity, ShieldCheck, ChevronDown, Store, Clock, Award, Receipt, FileText, BookOpen } from "lucide-react";'
);

// Add Transaksi Pelanggan
c = c.replace(
  '{ name: "Buku Pasien", href: "/admin/visits", icon: CalendarCheck },',
  '{ name: "Buku Pasien", href: "/admin/visits", icon: CalendarCheck },\n              { name: "Transaksi Pelanggan", href: "/admin/transactions", icon: BookOpen },'
);

// Add Transaksi Pelanggan Permissions
c = c.replace(
  'if (link.name === "Buku Pasien") return perms.includes("BUKUPASIEN_REKAMMEDIS");',
  'if (link.name === "Buku Pasien") return perms.includes("BUKUPASIEN_REKAMMEDIS");\n              if (link.name === "Transaksi Pelanggan") return perms.includes("KEUANGAN_PEMASUKAN") || perms.includes("BUKUPASIEN_REKAMMEDIS");'
);

// Add Buku Besar
c = c.replace(
  '{ name: "Laporan Laba Rugi", href: "/admin/finance/laba-rugi", icon: FileText },',
  '{ name: "Laporan Laba Rugi", href: "/admin/finance/laba-rugi", icon: FileText },\n                  { name: "Buku Besar", href: "/admin/finance/buku-besar", icon: Receipt },'
);

// Add Buku Besar Permissions
c = c.replace(
  'if (sub.name === "Laporan Laba Rugi") return perms.includes("KEUANGAN_LABARUGI");',
  'if (sub.name === "Laporan Laba Rugi") return perms.includes("KEUANGAN_LABARUGI");\n                  if (sub.name === "Buku Besar") return perms.includes("KEUANGAN_LABARUGI");'
);


fs.writeFileSync('src/app/admin/layout.tsx', c);
console.log('Layout updated successfully');
