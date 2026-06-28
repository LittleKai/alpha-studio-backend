# Alpha Studio — Nền Tảng Học Viện & Công Cụ AI Toàn Diện

## Tổng Quan
Alpha Studio (tại địa chỉ https://giaiphapsangtao.com/) là một nền tảng tiên phong kết hợp giữa hệ thống quản lý đào tạo (LMS) về Trí tuệ nhân tạo (AI Academy) và cung cấp các công cụ ứng dụng trực tiếp công nghệ AI Studio tiên tiến nhất. Nền tảng được thiết kế cho cả học viên muốn làm chủ AI và các đội ngũ/doanh nghiệp cần tối ưu hóa quy trình sáng tạo nội dung.

> **LƯU Ý QUAN TRỌNG:** Toàn bộ các dự án trong hệ sinh thái Alpha Studio hiện đều đang trong giai đoạn **Beta (Thử nghiệm)**. Điều này áp dụng cho tất cả các công cụ nằm trong tuyến đường `/studio` (bao gồm cả các công cụ truy cập công khai bên ngoài và các công cụ yêu cầu đăng nhập sử dụng bên trong). Hệ thống đang được liên tục hoàn thiện, nâng cấp và có thể có những thay đổi lớn về tính năng.

## Các Công Cụ Studio Chính (Generative AI)

### 1. Studio Flow (Tạo Ảnh/Video AI)
- **Trạng thái**: Beta (Thử nghiệm)
- **Tạo Ảnh AI**: Cung cấp các dòng mô hình AI tiên tiến, tốc độ cao và chất lượng xuất sắc giúp bạn thoả sức sáng tạo hình ảnh.
- **Tạo Video AI**: Hỗ trợ tạo video ngắn với đa dạng tỷ lệ khung hình. Cung cấp cả tính năng chuyển đổi từ ảnh tĩnh sang video sống động (Image-to-Video).
- **Tính năng nổi bật**: Cung cấp lịch sử tạo chi tiết, hỗ trợ tạo hàng loạt và xem trước nhanh chóng. Tất cả tệp tin được lưu trữ an toàn, dài hạn trên nền tảng đám mây.
- **Giới hạn sử dụng**: Mỗi tài khoản sẽ có lượt sử dụng công cụ AI hàng ngày (quota) độc lập cho Ảnh và Video để hệ thống phân bổ tài nguyên tối ưu cho tất cả người dùng.

### 2. Studio Gemini Edit (Công Cụ Chỉnh Sửa Ảnh)
- **Trạng thái**: Beta (Thử nghiệm)
- **Tính năng nổi bật**: Cung cấp hơn 20 bộ công cụ xử lý ảnh mạnh mẽ. Bạn có thể dễ dàng sửa ảnh trực quan, khoanh vùng chỉnh sửa tuỳ biến (Masking), tạo nháp phân cảnh đa nhân vật, thay đổi phông nền, và xử lý ảnh đa bước tinh tế.
- **Giới hạn sử dụng**: Các tính năng chỉnh sửa mạnh mẽ đều có giới hạn lượt sử dụng hàng ngày nhất định dành riêng cho mỗi tài khoản.

### 3. VocabFlip (Ứng Dụng Học Từ Vựng)
- **Đường dẫn**: `/studio/vocab`
- **Trạng thái**: Beta (Thử nghiệm)
- **Tính năng chính**:
  - Tạo bộ thẻ flashcard cá nhân đa ngôn ngữ.
  - Ôn tập từ vựng khoa học theo phương pháp Lặp Lại Ngắt Quãng (Spaced Repetition) với thuật toán ôn tập FSRS kết hợp SM-2.
  - Từ điển tích hợp tra nghĩa, phát âm hỗ trợ 4 ngôn ngữ: Tiếng Anh, Tiếng Việt, Tiếng Nhật, và Tiếng Trung với cơ sở dữ liệu StarDict offline 0ms.
  - Đồng bộ đám mây tự động với tài khoản Alpha Studio (tự động đăng nhập SSO khi mở bản Web).
- **Các phiên bản**:
  - **Bản Web**: Mở chạy trực tiếp trên trình duyệt.
  - **Bản Windows**: Tải file ZIP chạy trên máy tính Windows để học màn hình lớn.
  - **Bản Android**: Tải file APK cài đặt lên điện thoại Android để ôn tập mọi lúc mọi nơi.
- **Hạn mức**: Miễn phí hoàn toàn, không yêu cầu đăng ký gói tháng.

### 4. Alpha CRM (Hệ Thống Zalo Marketing Tự Động)
- **Đường dẫn**:
  - Ứng dụng khách: `/studio/crm` (yêu cầu giấy phép đang hoạt động).
  - Quản lý gói cước & cài đặt: `/studio/crm/subscription`.
- **Trạng thái**: Beta (Thử nghiệm)
- **Tính năng chính**:
  - Tự động hoá phễu tiếp thị Zalo, gửi tin nhắn hàng loạt và chăm sóc khách hàng tự động tối ưu chi phí.
  - Ghép nối thiết bị: Người dùng tải ứng dụng Windows Client và ứng dụng di động Android APK (Pair Connector), sau đó quét mã QR từ điện thoại để liên kết bot Zalo.
  - Hạn mức AI (AI Quota) hàng tháng hỗ trợ soạn thảo, tối ưu kịch bản và phản hồi tin nhắn tự động.
  - **Tóm tắt cuộc trò chuyện nhóm AI (Local-first & Privacy-first)**: Ứng dụng CRM cho phép quét tin nhắn từ bộ lưu trữ cục bộ, gửi dữ liệu transient lên đám mây để AI tổng hợp tóm tắt (insights, cơ hội, nhiệm vụ) và tự động đồng bộ vào quản lý tác vụ mà không lưu trữ tin nhắn thô trên backend.
- **Gói dịch vụ & gia hạn**:
  - Đăng ký mới tài khoản mặc định được tặng dùng thử 14 ngày (crm_trial) với 100 lượt yêu cầu AI.
  - Giấy phép chính gia hạn hàng tháng (1 tháng) giá 5250 credits (hoặc 500.000đ) bao gồm 1000 lượt yêu cầu AI.
  - Có các gói mua thêm hạn mức AI vĩnh viễn (AI Top-up): Gói +200 lượt AI (1000 credits hoặc 100.000đ), gói +1000 lượt AI (5000 credits hoặc 500.000đ), và gói +2000 lượt AI (10000 credits hoặc 1.000.000đ).
  - Hỗ trợ thanh toán nhanh bằng số dư Ví Credits hoặc quét mã VietQR tự động duyệt 24/7.

### 5. AI Interior Design (Thiết Kế Nội Thất AI)
- **Đường dẫn**: `/studio/interior-design` hoặc `/studio/interior-design/:projectId`
- **Trạng thái**: Beta (Thử nghiệm)
- **Tính năng chính**:
  - Dựng tủ áo 3D chuyên nghiệp (built-in wardrobes), tùy biến kích thước, vị trí các ngăn tủ, đợt kệ, thanh treo, cánh tủ phẳng/shaker trực quan.
  - Phân tích hình ảnh phác thảo / ảnh thực tế (Gemini Vision): Người dùng tải ảnh vẽ tay hoặc ảnh chụp phòng lên, AI tự động phân tích và chuyển đổi thành mô hình thiết kế tủ 3D chuẩn xác.
  - Trò chuyện tư vấn thiết kế AI: Trò chuyện trực tiếp với trợ lý AI để tinh chỉnh bản thiết kế theo yêu cầu tự nhiên (như "Thêm 2 ngăn kéo", "Đổi chất liệu sang gỗ sồi").
  - Xử lý CSG (Round corners, drawer/glass cutouts) giúp thiết kế có các góc bo tròn, tay nắm móc âm, cánh kính hiện đại.
  - Quản lý phiên bản lịch sử (History timeline): Lưu trữ các mốc thiết kế dưới dạng snapshot kèm ảnh thu nhỏ, hỗ trợ khôi phục (rollback) nhanh chóng.
  - Xác nhận 2 bước (Preferences): Cho phép bật chế độ Đề xuất (Proposal - 1 credit, chỉ phân tích mô tả không lưu phiên bản) và Áp dụng (Apply - 1 credit, cập nhật mô hình và tạo phiên bản mới) giúp tối ưu hóa tín dụng của người dùng.
- **Giới hạn và tín dụng**:
  - Mỗi lượt phản hồi thiết kế thành công của AI sẽ tiêu tốn 1 tín dụng (credit). Nếu bật chế độ xác nhận 2 bước, tiêu tốn 2 credits cho một lần áp dụng đầy đủ.
  - Tính năng phân tích ảnh phác thảo (`/analyze-image`) có giới hạn sử dụng 5 lượt/24 giờ đối với mỗi tài khoản thường.
  - Tài khoản Admin/Mod có quyền sử dụng không giới hạn tín dụng và bỏ qua các bước kiểm tra hạn mức.

## Học viện AI Academy & Kho tài nguyên

### 1. Hệ thống Khóa Học (Course Catalog)
- Toàn bộ video khóa học được tích hợp trình phát video chất lượng cao, mượt mà.
- **Tính năng học tập**: Hệ thống tự động ghi nhận tiến độ học tập, hỗ trợ tính năng tiếp tục xem video (Resume) chính xác tại nơi bạn đã dừng lại, cùng với tính năng tải xuống các tài liệu đính kèm bổ ích của bài học.
- Đăng ký và thanh toán các khóa học trả phí diễn ra nhanh chóng, tiện lợi bằng Ví Tín Dụng nội bộ.
- Đánh giá khóa học minh bạch với thang điểm 1-5 sao, đọc nhận xét từ các học viên khác. Khóa học có thể được giảng dạy bởi nhiều chuyên gia với phần thông tin, kỹ năng rõ ràng.

### 2. Share Prompts (Thư viện Prompt)
- Kho Prompt phong phú chia theo danh mục (Sáng tạo văn bản, Tạo ảnh, Lập trình, Tối ưu công việc) và các nền tảng AI phổ biến hiện nay.
- Hỗ trợ xem nhiều kết quả mẫu từ prompt, giúp học viên linh hoạt lưu lại (Bookmark) và thả tim (Like) những nội dung chất lượng nhất. 

### 3. Resource Hub (Kho tài nguyên)
- Phân loại đa dạng các tài nguyên cần thiết cho công việc sáng tạo: Biểu mẫu, Tập dữ liệu, Tài nguyên thiết kế, Tệp dự án, Mô hình 3D, Phông chữ...
- Học viên có thể tải lên và chia sẻ các tệp tài nguyên kích thước lớn một cách dễ dàng.

## Dashboard Workflow & Quản lý Dự Án
- Mọi dự án đều được tích hợp môi trường làm việc nhóm hiệu quả, bao gồm quản lý các thành viên, trao đổi trực tiếp, ghi chép nhật ký chi tiêu và giao việc.
- Tính năng ghi chú cho tài liệu dự án trực quan, cho phép đính kèm tệp tin liên quan lưu trữ lâu dài.
- Giao diện quản lý thông minh giúp sắp xếp, lọc dự án theo phòng ban hoặc mức độ ưu tiên một cách linh hoạt.

## Quản lý Ví & Gói Cloud Desktop
- **Ví tín dụng (Wallet)**: Quản lý số dư trực quan, hỗ trợ nạp tự động cực kỳ nhanh chóng thông qua mã VietQR. Số dư trong ví được dùng để đăng ký các khóa học hoặc mua các gói công cụ, tính năng mở rộng.
- **Cloud Desktop**: Trải nghiệm thực hành trực tiếp không rào cản. Học viên được cấp quyền truy cập ngay vào máy tính đám mây tốc độ cao thông qua trình duyệt web mà không cần cài đặt phần mềm phức tạp hay cấu hình máy tính cá nhân mạnh. 
- Tính năng sẽ tự động ngắt kết nối an toàn khi học viên ngừng sử dụng để bảo đảm an toàn dữ liệu và tiết kiệm tài nguyên hệ thống.

## Hệ thống Tài khoản
- **Vai trò (Roles)**: 
  - **Student**: Học viên trải nghiệm nền tảng giáo dục và thực hành AI. Các học viên xuất sắc có thể xuất hiện trong danh sách tiêu biểu (Featured Student).
  - **Partner**: Đối tác, cung cấp hồ sơ chuyên môn công khai bao gồm kỹ năng và dịch vụ để kết nối hợp tác.
- Mọi thao tác xoá hoặc ngắt kết nối quan trọng đều được hệ thống cảnh báo cẩn thận bằng hộp thoại thông minh.
- Hỗ trợ giao diện đa ngôn ngữ linh hoạt cho người dùng, chuyển đổi mượt mà giữa Tiếng Việt (mặc định) và Tiếng Anh.

## Liên Hệ Hỗ Trợ
- Đội ngũ luôn sẵn sàng lắng nghe mọi phản hồi để cải thiện nền tảng.
- Cam kết bảo mật thông tin: Dữ liệu cá nhân, tệp tin dự án, prompt và lịch sử sử dụng đều được mã hóa an toàn, đảm bảo tính riêng tư tuyệt đối cho từng cá nhân và doanh nghiệp.
