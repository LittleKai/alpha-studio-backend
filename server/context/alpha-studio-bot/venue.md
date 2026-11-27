# Alpha Studio — Cẩm Nang Thông Tin Toàn Diện Cho Người Dùng

## 1. Giới Thiệu Về Alpha Studio
**Alpha Studio** (website chính thức: https://giaiphapsangtao.com/) là nền tảng kết hợp giữa:
- **Dịch vụ Thiết kế & Dựng hình 3D theo yêu cầu (`/services`, `/contact`)**: Dựng không gian sự kiện từ ảnh tham chiếu, render SketchUp, thiết kế nội thất, dựng kiến trúc từ CAD/PDF, thiết kế sân khấu 3D / LED / DMX, dựng asset/nhân vật 3D và biên đạo StagePack.
- **Hệ sinh thái Công cụ Sáng tạo AI (`/studio`)**: Gồm 5 công cụ trọng tâm trên Studio Hub (**Thư viện Tri thức Sự kiện**, **Alpha CRM**, **LumiStage · LED Stage Studio 3D**, **VocabFlip**, **VietYaku**) cùng công cụ tạo/chỉnh sửa ảnh & video AI (`/studio/generate`, `/studio/edit`).
- **Học viện Đào tạo AI thực chiến (`/courses`)**: Các khóa học chuyên sâu từ cơ bản đến nâng cao giúp học viên ứng dụng AI vào sự kiện, đồ họa, video, thiết kế 3D/nội thất và tự động hóa.

> **Lưu ý:** Các công cụ tại chuyên mục `/studio` đang hoạt động mở thử nghiệm (Beta) và được nâng cấp liên tục.

---

## 2. Dịch Vụ Thiết Kế & Dựng Hình 3D (/services & /contact)
Alpha Studio trực tiếp tư vấn và triển khai các dự án thiết kế 3D cho sự kiện, sân khấu, nội thất và kiến trúc:
- **Quy trình triển khai 4 giai đoạn**:
  1. **Thu nhận yêu cầu & Lên ý tưởng (Input)**: Phân tích bối cảnh, mặt bằng, ảnh tham chiếu hoặc hồ sơ CAD/PDF.
  2. **Dựng mô hình kỹ thuật 3D / SketchUp / Blender**: Xây dựng mô hình không gian theo tỷ lệ thực tế.
  3. **Phối cảnh siêu thực bằng AI (AI Render)**: Kết hợp AI để tạo các góc phối cảnh ánh sáng, vật liệu chân thực.
  4. **Hồ sơ kỹ thuật & Thi công thực tế (Real)**: Hoàn thiện bản vẽ, mô hình chỉnh sửa được phục vụ gia công và thi công.
- **Các nhóm dịch vụ & Case Study tiêu biểu trên `/services`**:
  - Dựng 3D sự kiện từ ảnh tham chiếu, Image-to-3D và Video-to-3D LED.
  - Chuyển góc SketchUp thành ảnh phối cảnh thực tế.
  - Thiết kế đồ nội thất (tủ, bàn, bếp) với mô hình SketchUp, số đo chi tiết và trang HTML tương tác.
  - Dựng nhà phố & kiến trúc từ hồ sơ CAD/PDF.
  - Các dự án tiêu biểu: **Lễ hội Đường hoa (Flower Street)**, **HOME**, **Nhà anh Thái**, **Lào Cai**, **Image-to-3D**, **Video-to-3D LED**.
- **Tính năng trên trang `/services`**:
  - **Xem ảnh Lightbox** độ phân giải cao và **Video xem trước** (trình phát MP4/WebM trực tiếp trong bài).
  - **Tải tệp tham khảo gốc** (như file SketchUp `.skp`, tài liệu kỹ thuật lưu trên Backblaze B2).
  - **Bình luận & Trao đổi** trực tiếp dưới mỗi bài dự án.
- **Báo giá & Gửi Brief đặt thiết kế (`/contact`, `/lien-he`)**:
  - Báo giá và tiến độ được trao đổi theo **brief từng dự án** (không áp bảng giá cố định cho dịch vụ thiết kế theo yêu cầu).
  - Trang `/contact` hỗ trợ chọn nhanh 4 hạng mục (`Thiết kế sân khấu 3D`, `Dựng Asset & Nhân vật 3D`, `Biên đạo 3D & StagePack`, `Tư vấn & Hợp tác khác`), tự động tạo nội dung tin nhắn Brief để gửi ngay qua **WhatsApp**, **Email**, hoặc sao chép dán vào **Zalo / Facebook**.

---

## 3. Hệ Sinh Thái Công Cụ AI Studio (/studio)

### 🎬 LumiStage · LED Stage Studio 3D (/studio/led-studio)
- **Mục đích**: Nền tảng WebGL2 60 FPS chạy trực tiếp trên trình duyệt (hỗ trợ offline grace 7 ngày cho bản quyền) dành cho đạo diễn sân khấu, kỹ sư AVL và đơn vị tổ chức sự kiện.
- **Cách truy cập**: Trang `/studio/led-studio` hiển thị thông tin giới thiệu công khai; cần **đăng nhập tài khoản Alpha Studio** hoặc mở qua **liên kết chia sẻ `?share=`** (có thể kèm mật khẩu do chủ dự án cấp) để vào không gian 3D.
- **Tính năng nổi bật**:
  - **Sân khấu 3D & Pixel Mapping hệ mét**: 6 bộ sân khấu mẫu Việt Nam, màn hình LED cong/trụ/lượn sóng, đi dây tín hiệu RJ45 & nguồn PowerCON (NovaStar/Brompton), đóng gói Atlas 4K và xuất XML Resolume Arena.
  - **128 Đèn DMX512, Laser ILDA & Vũ đạo 3D**: 22 hồ sơ đèn OFL 16-bit xoay Pan/Tilt thật, 35 hiệu ứng viền LED Matrix 3D, Laser ILDA 30kpps, Timecode 200Hz, pháo điện Pyro TCVN và 19 nghệ sĩ 3D biểu diễn đồng bộ theo nhạc (`StagePack`).
  - **Trợ lý AI & Hồ sơ kỹ thuật / CAD**: Trợ lý AI **Gemini 3.8 Flash** (3 mức: Low / Medium / High), tự động bóc tách khối lượng (BOM), tính tải điện 3 pha 380V & độ võng Truss; gói PRO xuất bản vẽ AutoCAD `.DXF`, `.MVR` (DIN 15800), GrandMA2/MA3 XML, hồ sơ báo giá/kỹ thuật/Crew Split và link duyệt 3D cho khách hàng.
- **Chính sách giá & AI Credits (1 Credit = 100 VNĐ · Sản phẩm phần mềm không chịu thuế GTGT)**:
  - **Miễn phí dùng thử**: Tặng sẵn **100 AI Credits** dùng thử; hỗ trợ **BYOK (API Key cá nhân) 0 Credit**.
  - **Giá token AI Web (Gemini 3.8 Flash — bằng 1/2 giá Gemini chính thức)**: **38 Credits / 1M Input tokens** và **318 Credits / 1M Output tokens** (tối thiểu 0.01 Credit/lần).
  - **Xuất file sạch không watermark**: Xuất lẻ **50 Credits** (5.000đ) / 1 file; mở khóa trọn gói 1 dự án (xóa watermark vĩnh viễn): **200 Credits** (20.000đ).
  - **Các gói LumiStage PRO**:
    - **LumiStage Pro 1 tháng**: **149.000đ** (1.490 Credits) — tặng kèm **300 AI Credits**.
    - **LumiStage Pro 3 tháng**: **399.000đ** (3.990 Credits) — tặng kèm **1.000 AI Credits**.
    - **LumiStage Pro 12 tháng**: **1.390.000đ** (13.900 Credits) — tặng kèm **4.500 AI Credits**.
    - **LumiStage Show Pro+ (Chạy Show DMX/Art-Net · 1 tháng)**: **299.000đ** (2.990 Credits) — tặng kèm **800 AI Credits**.

---

### 📚 Thư Viện Tri Thức Sự Kiện (/studio/event-library)
- **Mục đích**: Kho tri thức thực chiến dành cho ngành tổ chức sự kiện, truyền thông và sáng tạo.
- **7 loại nội dung**: **Case Study** (kèm ngân sách, reach, KPI thực tế), **Prompt**, **Workflow**, **Skill**, **Template**, **Report** và **Playbook**.
- **Tính năng & Quyền truy cập**:
  - Hỗ trợ bộ lọc theo danh mục, ngành hàng, mục tiêu chiến dịch, ngân sách, KPI, cấp xác thực, độ sâu phân tích; xem video xem trước và tải tệp đính kèm Backblaze B2.
  - Người dùng có thể đăng tài liệu của mình từ `/workflow` lên thư viện (chế độ Riêng tư hoặc Công khai).
  - Mục **Miễn phí (Public)** mở cho tất cả mọi người; mục **Pro** mở cho tài khoản đã từng **tích luỹ từ 200 Credits trở lên** (tính cả credit nạp lẫn credit được cấp, không phụ thuộc số dư hiện tại).

---

### 💬 Alpha CRM — Tiếp Thị & Chăm Sóc Khách Hàng Đa Kênh (/studio/crm)
*(Lưu ý: đường dẫn cũ `/studio/crm/subscription` tự động chuyển hướng về `/studio/crm#subscription`.)*
- **Mục đích**: Hệ thống quản lý khách hàng, tự động hóa chăm sóc khách hàng và chiến dịch tiếp thị đa kênh cho cá nhân kinh doanh và doanh nghiệp.
- **Tính năng nổi bật**:
  - **Kết nối đa nền tảng**: Hỗ trợ Zalo (cá nhân và Zalo OA), Facebook Messenger, TikTok, Instagram, WhatsApp, Telegram và tiện ích Webchat widget nhúng vào Website.
  - **Gửi tin nhắn & Chăm sóc tự động**: Quản lý danh bạ, gắn nhãn (tags), gửi tin nhắn hàng loạt giãn cách an toàn, kịch bản chăm sóc và phản hồi tự động bằng AI.
  - **Tóm tắt cuộc trò chuyện nhóm bằng AI**: Tự động đọc và tổng hợp thông tin quan trọng, quyết định, cơ hội kinh doanh, rủi ro và việc cần làm (action items).
  - **Bảo mật Local-First**: Dữ liệu tin nhắn lưu trực tiếp trên máy tính người dùng.
  - **Ứng dụng đi kèm**: **Windows Client** chính thức (Windows 10 64-bit trở lên); **Android APK** hiện đang ở bản **Demo (thử nghiệm)** dùng ghép nối QR với PC (khuyến nghị dùng Windows để đầy đủ tính năng).
- **Chính sách gói cước & AI Credits (tính theo token · 1/2 giá Gemini gốc · tối thiểu 0.01 Credit/lần)**:
  - **Dùng thử**: Đăng ký mới nhận **30 ngày (1 tháng) dùng thử miễn phí** kèm **100 AI Credits** (cấp 1 lần cho tài khoản mới).
  - **Gói gia hạn hàng tháng**: **100.000đ/tháng** (hoặc **1.000 Credits**) bao gồm **200 AI Credits** mỗi chu kỳ.
  - **Gói nạp thêm AI Credits (không hết hạn khi gói chính còn hạn)**:
    - Gói 500 AI Credits: **50.000đ** (500 Credits).
    - Gói 2.200 AI Credits (+10% ưu đãi): **200.000đ** (2.000 Credits).
    - Gói 4.000 AI Credits (+14% ưu đãi): **350.000đ** (3.500 Credits).

---

### 📖 VocabFlip — Học Từ Vựng & Luyện Chữ Ngoại Ngữ (/studio/vocab)
- **Mục đích**: Ứng dụng học từ vựng 4 ngôn ngữ (**Tiếng Anh, Tiếng Việt, Tiếng Trung, Tiếng Nhật**) bằng flashcard thông minh.
- **Tính năng nổi bật**:
  - Thuật toán lặp lại ngắt quãng **FSRS / FSRS-4.5** tối ưu lịch ôn tập.
  - Tích hợp sẵn **từ điển StarDict offline**, phát âm chuẩn (TTS) và **luyện viết Hán tự / Kanji theo nét**.
  - Hỗ trợ nhập/xuất thẻ từ **Anki, Excel, CSV**, thư viện bộ thẻ cộng đồng, đồng bộ đám mây qua tài khoản Alpha Studio và **Trợ lý AI tự động tạo thẻ từ vựng**.
- **Nền tảng & Chi phí**: Có **bản Web** (`/studio/vocab`), **Windows** (ZIP/cài đặt) và **Android APK** (khuyến nghị dùng bản Windows hoặc Android để có đầy đủ tính năng và chạy offline ổn định). **Miễn phí sử dụng (không cần gói tháng)**.

---

### 🌐 VietYaku — Phần Mềm Converter Dịch Thuật Nhật/Trung → Việt (/studio/vietyaku)
- **Mục đích**: Phần mềm converter hỗ trợ dịch thuật tiếng Nhật và tiếng Trung sang tiếng Việt theo phong cách VietPhrase (kế thừa và cải tiến từ QuickConverter — Tàng Thư Viện).
- **Tính năng nổi bật**:
  - Dịch ngoại tuyến **100% offline** tức thì với **14 bộ từ điển Nhật – Trung – Việt** tích hợp sẵn và thuật toán khớp cụm dài nhất linh hoạt.
  - Hỗ trợ tra nghĩa online song song (Mazii, Google Dịch, Jisho, Weblio, Youdao) và công cụ sửa bộ từ điển tiếng Nhật lỗi phông.
- **Nền tảng & Chi phí**: **Windows** (bản Portable ZIP tự kiểm tra & thông báo cập nhật mới) và **Android APK** (hiện đang ở giai đoạn **Thử nghiệm / Beta**, khuyến nghị dùng bản Windows để đầy đủ tính năng). **Miễn phí tải về tại `/studio/vietyaku`**.

---

### 🎨 Tạo Ảnh & Chỉnh Sửa Ảnh/Video AI (/studio/generate & /studio/edit)
- **Tạo Ảnh & Video AI (`/studio/generate`)**:
  - Tạo ảnh với **Nano Banana 2** và **Nano Banana Pro** (hỗ trợ tối đa 4 ảnh tham chiếu, nhiều tỷ lệ 1:1, 16:9, 9:16, 4:3, 3:4).
  - Tạo video (Text → Video và Ảnh → Video với chế độ Frames / Ingredients, thời lượng 4s/6s/8s) bằng **Veo 3.1** (Lite, Fast, Quality, Lower Priority).
  - Hỗ trợ tải chất lượng cao (ảnh 1K/2K miễn phí lượt, **4K tốn 50 Credits**; video 270p GIF/720p/1080p, **4K tốn 500 Credits**). File chưa lưu sẽ hết hạn sau 48 giờ.
  - **Hạn mức miễn phí hàng ngày**: **5 lượt tạo ảnh/ngày** và **1 lượt tạo video/ngày** cho tài khoản thường (Admin/Mod không giới hạn).
- **Chỉnh Sửa Ảnh AI (`/studio/edit`)**:
  - Khoanh vùng vẽ Mask (Inpainting), ghép nhiều ảnh, preset biến đổi và storyboard bằng `Gemini 2.5 Flash Image` / `Gemini 3 Pro Image` (**3 lượt miễn phí/ngày**).
  - Tích hợp **Thiết kế nội thất AI** quản lý dự án tủ/nội thất theo nhiều phiên bản (rollback 1 chạm), xuất `.obj + .mtl` cho SketchUp và bộ ảnh/prompt cho AI render (tính Credit theo token thực tế bằng 1/2 giá Gemini gốc, tối thiểu 0.01 Credit/lần).

*(Lưu ý: Các đường dẫn cũ `/studio/ai-skills`, `/studio/skills` và `/studio/interior-design` đã được gỡ bỏ.)*

---

## 4. Học Viện AI Academy & Khóa Học (/courses)
- Cung cấp các khóa học thực chiến về ứng dụng AI trong sự kiện, đồ họa, video, marketing, thiết kế 3D/nội thất và tự động hóa.
- Trình phát video ghi nhớ vị trí xem tiếp (Resume playback), tải tài liệu đính kèm và đánh giá từ học viên.
- Thanh toán đăng ký khóa học bằng số dư Ví Tín Dụng (Credits); quản lý khóa học đã đăng ký tại `/my-courses`.

---

## 5. Quản Lý Dự Án & Làm Việc Nhóm — Alpha Connect (/workflow)
- Tạo dự án sáng tạo, phân chia công việc, theo dõi tiến độ và quản lý thu chi đội ngũ.
- Lưu trữ tài liệu an toàn trên Backblaze B2 và xuất bản dự án tiêu biểu lên Thư viện Tri thức Sự kiện (`/studio/event-library`).
- Kết nối hồ sơ học viên (`/students/:id`) và mạng lưới đối tác chiến lược (`/partners/:id`).

---

## 6. Ví Tín Dụng (/wallet) & Máy Tính Đám Mây AI (/server)

### 💳 Ví Tín Dụng (`/wallet`)
- **Quy chuẩn hệ thống**: **1 Credit = 100 VNĐ**.
- **Nạp tiền tự động 24/7**: Quét mã **VietQR (Casso)** (tối thiểu 10.000đ, tối đa 100.000.000đ), tự động cộng Credits vào ví sau vài giây đến 1–5 phút.
- **Phạm vi sử dụng Credits**: Đăng ký khóa học, gia hạn/nạp AI Credits cho Alpha CRM, mua gói/xuất file LumiStage PRO, mở nội dung Pro ở Thư viện Sự kiện (tích luỹ ≥ 200 Credits), và các tính năng AI tính theo token.
- **Bảng giá AI theo token (1/2 giá Gemini chính thức · BYOK = 0 Credit)**:
  - **Gemini 3.1 Flash Lite**: **13 Credits / 1M Input tokens** · **51 Credits / 1M Output tokens**.
  - **Gemini 3.8 Flash**: **38 Credits / 1M Input tokens** · **318 Credits / 1M Output tokens**.
  - *(Tối thiểu 0.01 Credit/lần gọi thành công.)*

### 🖥️ Máy Tính Đám Mây AI (`/server`)
- Cung cấp máy chủ đám mây cấu hình GPU cao (**RTX 4090**) chạy trực tiếp trên trình duyệt qua **noVNC** để thực hành ComfyUI, Stable Diffusion, Blender...
- Tự động ngắt kết nối an toàn khi người dùng rời đi. Yêu cầu đăng nhập tài khoản để truy cập `/server`.

---

## 7. Tin Tức, Giới Thiệu & Tài Khoản
- **Tin tức (`/news`)** và **Giới thiệu (`/about`)**: Cập nhật kiến thức AI, xu hướng ngành sự kiện và thông tin về Alpha Studio.
- **Hồ sơ cá nhân (`/profile`)**, **Học viên (`/students/:id`)** và **Đối tác (`/partners/:id`)**: Trưng bày tác phẩm nổi bật, kỹ năng và kết nối cơ hội hợp tác.
- **Đa ngôn ngữ & Giao diện**: Hỗ trợ **Tiếng Việt (mặc định)** và **Tiếng Anh**; chế độ tối (Dark) và sáng (Light).

---

## 8. Kênh Hỗ Trợ Khách Hàng & Thông Tin Liên Hệ (/contact)
- **Website chính thức**: https://giaiphapsangtao.com/
- **Trang liên hệ & Tạo nhanh Brief**: https://giaiphapsangtao.com/contact (hoặc `/lien-he`)
- **Email nhận brief & hợp tác chính thức**: **giaiphapkhonggiansangtao@gmail.com**
- **Liên hệ trực tiếp**:
  1. **Kiều Tấn Thành** — *Tư vấn giải pháp & báo giá dự án*
     - **Điện thoại / Zalo**: **0901555697** (https://zalo.me/0901555697)
     - **WhatsApp**: https://wa.me/84901555697
     - **Facebook**: https://www.facebook.com/thanh.tan.92560
  2. **Nguyễn Anh Đức** — *Đào tạo AI & hỗ trợ kỹ thuật (Người sáng lập)*
     - **Điện thoại / Zalo**: **0933805525** (https://zalo.me/0933805525)
     - **WhatsApp**: https://wa.me/84933805525
     - **Facebook**: https://www.facebook.com/anhduc.nguyen.311/
- **Trợ lý AI trên Website**: Luôn sẵn sàng ở góc phải màn hình để giải đáp thắc mắc 24/7 (cần đăng nhập; giới hạn **10 lượt hỏi/ngày** cho mỗi tài khoản thường để đảm bảo ổn định, làm mới lúc 00:00 mỗi ngày).
