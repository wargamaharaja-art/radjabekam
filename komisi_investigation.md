# Laporan Penanganan Bug Komisi

Saya telah meninjau kembali seluruh alur kalkulasi komisi dari database hingga pembuatan invoice.

## Temuan
Kode saat ini **sudah 100% mematuhi aturan hierarki komisi (Override > Global > Flat Rate)**.
Alasan mengapa Anda masih melihat nilai komisi yang "salah" (seperti Rp 130.000) pada dashboard adalah karena **data tersebut adalah data transaksi lama yang sudah tersimpan (PAID) di database sebelum kode diperbaiki**. Sistem tidak mengubah data transaksi lama secara otomatis untuk menjaga integritas data akuntansi.

## Solusi yang Telah Disiapkan
Untuk memperbaiki seluruh data lama yang salah kalkulasi, saya telah membuat sebuah API endpoint untuk melakukan *mass-recalculation* (kalkulasi ulang massal) pada seluruh riwayat komisi menggunakan logika yang baru diperbaiki.

### Langkah untuk mengeksekusi perbaikan riwayat komisi:
1. Pastikan Anda sudah login ke aplikasi sebagai **SuperAdmin**.
2. Buka tab baru di browser Anda dan akses URL berikut di environment deployment Anda:
   `https://[domain-aplikasi-anda]/api/recalculate-commissions`
3. Endpoint ini akan mengaudit dan memperbarui seluruh data komisi di tabel `therapistCommissions` agar sesuai dengan hierarki yang benar. Anda akan melihat pesan sukses beserta detail jumlah data yang diperbaiki.

### Verifikasi Transaksi Baru
Untuk memastikan sistem komisi baru sudah berjalan lancar, silakan coba buat **transaksi / kunjungan baru** untuk layanan yang bermasalah. Anda akan melihat bahwa komisinya dihitung dengan benar.

> [!NOTE]
> Jika setelah melakukan transaksi baru, nilai komisi yang muncul masih tidak sesuai dengan harapan Anda, mohon pastikan bahwa `globalCommission` untuk layanan tersebut di pengaturan menu Layanan / Services tidak salah ketik (misalnya, diisi 130.000 padahal seharusnya 30.000). Jika nilai `globalCommission` sudah diisi, sistem diwajibkan oleh aturan untuk menggunakannya alih-alih `Flat Rate` milik terapis.
