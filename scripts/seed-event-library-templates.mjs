/**
 * Bộ template mẫu cho Thư viện tri thức sự kiện.
 *
 *   node scripts/seed-event-library-templates.mjs           # dry-run
 *   node scripts/seed-event-library-templates.mjs --apply   # ghi vào DB
 *   node scripts/seed-event-library-templates.mjs clean     # xoá đúng 6 mục này
 *
 * ⚠️ CÁC MỤC NÀY KHÔNG CÓ FILE ĐÍNH KÈM.
 * Template thường đi kèm file tải về (`attachments` trỏ vào B2), nhưng seed
 * script không có file thật để upload — và bịa URL B2 sẽ tạo link 404. Nên cấu
 * trúc template được viết THẲNG vào thân bài dưới dạng bảng / checklist, dùng
 * được ngay mà không cần tải gì. Muốn có file: mở mục trong trình đăng
 * (/workflow → Đăng Lên Thư Viện → Sửa) và thêm ở mục "Tài liệu đính kèm".
 *
 * Vì `attachments` rỗng nên card ngoài danh sách sẽ KHÔNG hiện nút "Tải về" —
 * đúng như thiết kế, không phải lỗi.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import EventLibraryItem from '../server/models/EventLibraryItem.js';

const SKILL = {
    booth: 'skill-thiet-ke-booth-va-luong-di-chuyen',
    stage: 'skill-kich-ban-san-khau-va-dieu-phoi-cue',
    roadshow: 'skill-lap-tuyen-va-van-hanh-roadshow',
    budget: 'skill-boc-tach-ngan-sach-va-boq-su-kien',
    livestream: 'skill-san-xuat-livestream-va-su-kien-hybrid'
};

const SLUGS = {
    boq: 'template-khung-boq-su-kien-7-nhom',
    cue: 'template-bang-cue-san-khau',
    booth: 'template-checklist-thi-cong-booth',
    roadshow: 'template-ke-hoach-tuyen-roadshow',
    proposal: 'template-khung-proposal-su-kien',
    live: 'template-checklist-san-xuat-livestream'
};

/**
 * Ảnh bìa sinh bằng skill `delegate --type=image` của hybrid-ai-skills (Gemini image
 * qua Antigravity) rồi đẩy lên Cloudinary folder `event-library` bằng unsigned preset.
 * Master + bảng prompt: deliverables/event-library-covers/
 */
const COVER = {
    boq: 'https://res.cloudinary.com/dzchj4ysj/image/upload/v1788067618/event-library/xcgwdlqynzwzxbtaq1h5.jpg',
    cue: 'https://res.cloudinary.com/dzchj4ysj/image/upload/v1788067620/event-library/mnkb6w1ohdppmvuxibqa.jpg',
    booth: 'https://res.cloudinary.com/dzchj4ysj/image/upload/v1788067621/event-library/u2one5pwioynpk7i224j.jpg',
    roadshow: 'https://res.cloudinary.com/dzchj4ysj/image/upload/v1788067623/event-library/ijixw4kgqfk8rkw33jgv.jpg',
    proposal: 'https://res.cloudinary.com/dzchj4ysj/image/upload/v1788067624/event-library/xxldkmekau3fvkwihppc.jpg',
    live: 'https://res.cloudinary.com/dzchj4ysj/image/upload/v1788067626/event-library/ehvbkjesa1kzrrrjhdvz.jpg',
};
const base = {
    itemType: 'template',
    ownership: 'platform',
    visibility: 'public',
    owner: null,
    verification: 'unverified',
    sourceName: 'Alpha Studio — Biên tập nội bộ',
    authorName: 'Alpha Studio',
    origin: { kind: 'manual', refId: null },
    attachments: [],
    stats: { views: 0, uses: 0 }
};

/** Ghi chú đặt cuối mọi template, giải thích vì sao chưa có file tải về. */
const noFileNote = {
    kind: 'richText',
    title: 'Về file tải về',
    html: '<p>Bản mẫu này hiện <strong>chưa đính kèm file</strong> — toàn bộ cấu trúc đã nằm trong bài, sao chép thẳng vào Excel hoặc Google Sheets là dùng được. Nếu bạn có file bản chuẩn của công ty, mở mục này trong trình đăng và thêm vào phần “Tài liệu đính kèm”; nút tải về sẽ tự xuất hiện trên card.</p>'
};

const items = [
    {
        ...base,
        slug: SLUGS.boq,
        coverImage: COVER.boq,
        title: { vi: 'Khung BOQ sự kiện — 7 nhóm', en: 'Event BOQ Framework — 7 Groups' },
        summary: {
            vi: 'Khung bảng khối lượng phát cho nhà thầu, cấu trúc cố định để báo giá so sánh được theo từng dòng.',
            en: 'A fixed-structure bill of quantities to hand vendors, so quotes stay comparable line by line.'
        },
        category: 'event',
        industries: ['fmcg', 'technology', 'finance', 'retail_mall'],
        objectives: ['internal_corporate'],
        kpis: ['sales_conversion'],
        depth: 'benchmark',
        tags: ['template', 'boq', 'budget', 'procurement'],
        metrics: [
            { label: 'Nhóm mục', value: '7' },
            { label: 'Cột bảng', value: '6' }
        ],
        sections: [
            {
                kind: 'richText',
                title: 'Dùng thế nào',
                html: '<p>Phát khung này cho <strong>mọi nhà thầu cùng lúc</strong>, yêu cầu điền đúng vào các dòng có sẵn, không tự thêm hay gộp nhóm. Khi nhận về, so theo từng dòng — chênh lệch lớn ở một dòng nghĩa là hai bên đang hiểu khác nhau về phạm vi, không phải bên nào rẻ hơn.</p>'
            },
            {
                kind: 'keyValue',
                title: 'Cấu trúc cột',
                rows: [
                    { label: 'A. Nhóm', value: 'Một trong 7 nhóm chuẩn, không tạo nhóm mới' },
                    { label: 'B. Hạng mục', value: 'Mô tả cụ thể, đủ để nhà thầu biết phải báo cái gì' },
                    { label: 'C. Đơn vị', value: 'm², cái, bộ, ngày, người-ngày…' },
                    { label: 'D. Số lượng', value: 'Bên mời thầu điền trước, nhà thầu không sửa' },
                    { label: 'E. Đơn giá', value: 'Nhà thầu điền' },
                    { label: 'F. Ghi chú kỹ thuật', value: 'Vật tư, tiêu chuẩn, điều kiện áp dụng' }
                ]
            },
            {
                kind: 'keyValue',
                title: 'Bảy nhóm và ví dụ hạng mục',
                rows: [
                    { label: '1. Mặt bằng', value: 'Thuê địa điểm · Phí dịch vụ · Điện nước · Phí thi công ngoài giờ' },
                    { label: '2. Thi công', value: 'Vật tư · Nhân công dựng · Nhân công tháo · Vận chuyển · Đổ rác hoàn trả' },
                    { label: '3. Thiết bị', value: 'Âm thanh · Ánh sáng · Màn hình · Máy phát dự phòng · Nhiên liệu' },
                    { label: '4. Nội dung', value: 'Thiết kế · Sản xuất video · In ấn · Bản quyền nhạc' },
                    { label: '5. Nhân sự', value: 'Ê-kíp vận hành · MC · PG/PB · An ninh · Y tế' },
                    { label: '6. Vận hành', value: 'Ăn uống ê-kíp · Đi lại · Lưu trú · Bảo hiểm' },
                    { label: '7. Dự phòng', value: 'Một dòng riêng, tỷ lệ ghi rõ — không phân bổ ngầm vào các nhóm trên' }
                ]
            },
            {
                kind: 'bulletGroups',
                title: 'Quy tắc phát và nhận',
                groups: [
                    {
                        title: 'Khi phát',
                        items: [
                            'Ghi rõ những gì KHÔNG nằm trong phạm vi báo giá',
                            'Khoá cột số lượng để nhà thầu không tự sửa',
                            'Đặt hạn nộp và định dạng file thống nhất'
                        ]
                    },
                    {
                        title: 'Khi nhận',
                        items: [
                            'Rà dòng trống trước khi rà tổng tiền',
                            'Hỏi lại mọi dòng chênh trên 30% giữa các nhà thầu'
                        ]
                    },
                    {
                        title: 'Trước khi chốt',
                        items: [
                            'Ghi lại toàn bộ giả định đi kèm giá',
                            'Xác nhận dòng dự phòng vẫn còn nguyên'
                        ]
                    }
                ]
            },
            { kind: 'linkedItems', title: 'Skill liên quan', links: [{ slug: SKILL.budget, label: 'Bóc tách Ngân sách & BOQ sự kiện' }] },
            noFileNote
        ]
    },

    {
        ...base,
        slug: SLUGS.cue,
        coverImage: COVER.cue,
        title: { vi: 'Bảng cue sân khấu', en: 'Stage Cue Sheet' },
        summary: {
            vi: 'Bảng điều phối để đạo diễn, âm thanh, ánh sáng và màn LED cùng chạy từ một nguồn duy nhất.',
            en: 'One sheet the director, audio, lighting and LED crew all run from.'
        },
        category: 'stage_production',
        industries: ['technology', 'finance', 'education'],
        objectives: ['internal_corporate', 'product_launch'],
        kpis: ['brand_recall'],
        depth: 'basic',
        tags: ['template', 'cue-sheet', 'stage', 'run-of-show'],
        metrics: [
            { label: 'Cột bảng', value: '7' },
            { label: 'Quy tắc', value: '5' }
        ],
        sections: [
            {
                kind: 'richText',
                title: 'Dùng thế nào',
                html: '<p>In ra và phát bản giấy cho từng bộ phận. <strong>Không dùng bản trên điện thoại</strong> trong lúc chạy chương trình — mất mạng hoặc hết pin là mất bảng.</p>'
            },
            {
                kind: 'keyValue',
                title: 'Bảy cột',
                rows: [
                    { label: 'Cue #', value: 'Chèn cue mới dùng số thập phân (12.5), không đánh lại toàn bảng' },
                    { label: 'Thời điểm', value: 'Dự kiến trước tổng duyệt, thay bằng số thật sau tổng duyệt' },
                    { label: 'Nội dung', value: 'Chuyện gì đang diễn ra trên sân khấu' },
                    { label: 'Hiệu lệnh', value: 'Ai gọi cue — chỉ một người duy nhất cho cả chương trình' },
                    { label: 'LED / Màn', value: 'Tên file đúng tuyệt đối như trên máy phát' },
                    { label: 'Âm thanh', value: 'Track, mic nào mở, mic nào tắt' },
                    { label: 'Ánh sáng', value: 'Preset hoặc mô tả trạng thái' }
                ]
            },
            {
                kind: 'steps',
                title: 'Năm quy tắc vận hành',
                steps: [
                    { title: 'Một giọng', desc: 'Chỉ một người gọi cue, mọi bộ phận nghe một nguồn' },
                    { title: 'Tên file trùng khớp', desc: 'Sai một ký tự là cue hỏng' },
                    { title: 'Cue cho hỏi đáp', desc: 'Phần Q&A cũng phải có cue và tín hiệu nhắc kết thúc' },
                    { title: 'Khoá bản sau tổng duyệt', desc: 'Sửa sau đó phải ghi tay và thông báo từng bộ phận' },
                    { title: 'Ghi lại thực tế', desc: 'Sau sự kiện, đánh dấu cue nào chạy khác dự kiến' }
                ]
            },
            { kind: 'linkedItems', title: 'Skill liên quan', links: [{ slug: SKILL.stage, label: 'Kịch bản sân khấu & Điều phối cue' }] },
            noFileNote
        ]
    },

    {
        ...base,
        slug: SLUGS.booth,
        coverImage: COVER.booth,
        title: { vi: 'Checklist thi công Booth', en: 'Booth Build Checklist' },
        summary: {
            vi: 'Danh mục kiểm tra theo bốn mốc: trước thi công, trong thi công, trước giờ mở, và tháo dỡ.',
            en: 'A four-milestone checklist: pre-build, during build, pre-open, and strike.'
        },
        category: 'booth_exhibition',
        industries: ['fmcg', 'technology', 'retail_mall'],
        objectives: ['brand_awareness'],
        kpis: ['attendance_reach'],
        depth: 'basic',
        tags: ['template', 'checklist', 'booth', 'production'],
        metrics: [
            { label: 'Mốc', value: '4' },
            { label: 'Mục kiểm', value: '14' }
        ],
        sections: [
            {
                kind: 'richText',
                title: 'Dùng thế nào',
                html: '<p>Mỗi mốc có một người ký xác nhận. <strong>Không chuyển sang mốc sau khi mốc trước còn mục chưa tick</strong> — phần lớn sự cố giờ chót là do bỏ qua một mục ở mốc trước đó.</p>'
            },
            {
                kind: 'bulletGroups',
                title: 'Bốn mốc kiểm tra',
                groups: [
                    {
                        title: 'Trước thi công',
                        items: [
                            'Bản vẽ đã duyệt, có ảnh tham chiếu in sẵn',
                            'Xác nhận vị trí ổ điện và công suất khớp bản vẽ',
                            'Giấy phép thi công và thẻ ra vào của ê-kíp',
                            'Đo lại kích thước mặt bằng thực tế'
                        ]
                    },
                    {
                        title: 'Trong thi công',
                        items: [
                            'Kiểm tra độ phẳng và chắc của sàn, vách',
                            'Đi dây điện gọn, không cắt ngang lối đi',
                            'Lắp thử toàn bộ thiết bị trước khi hoàn thiện bề mặt'
                        ]
                    },
                    {
                        title: 'Trước giờ mở',
                        items: [
                            'Đi thử luồng khách như một người lạ',
                            'Đo lại lối đi sau khi hàng hoá đã vào booth',
                            'Bật toàn bộ màn hình, kiểm tra nội dung đúng phiên bản cuối',
                            'Vệ sinh, gỡ nhãn dán bảo vệ, cất dụng cụ khỏi tầm khách'
                        ]
                    },
                    {
                        title: 'Tháo dỡ',
                        items: [
                            'Chụp ảnh hiện trạng trước khi tháo',
                            'Kiểm đếm thiết bị thuê theo danh sách',
                            'Hoàn trả mặt bằng và lấy xác nhận'
                        ]
                    }
                ]
            },
            { kind: 'linkedItems', title: 'Skill liên quan', links: [{ slug: SKILL.booth, label: 'Thiết kế Booth & Luồng di chuyển' }] },
            noFileNote
        ]
    },

    {
        ...base,
        slug: SLUGS.roadshow,
        coverImage: COVER.roadshow,
        title: { vi: 'Kế hoạch tuyến Roadshow', en: 'Roadshow Route Plan' },
        summary: {
            vi: 'Bảng lập tuyến kèm tiêu chí chọn điểm, lịch có ngày đệm và biểu mẫu ghi nhận sau mỗi chặng.',
            en: 'A route sheet with stop-selection criteria, buffered scheduling and a per-stop debrief form.'
        },
        category: 'roadshow',
        industries: ['automotive', 'fmcg', 'technology'],
        objectives: ['brand_awareness', 'product_launch'],
        kpis: ['attendance_reach', 'leads_database'],
        depth: 'deep',
        tags: ['template', 'roadshow', 'route', 'logistics'],
        metrics: [
            { label: 'Cột bảng', value: '8' },
            { label: 'Mục ghi nhận', value: '5' }
        ],
        sections: [
            {
                kind: 'richText',
                title: 'Dùng thế nào',
                html: '<p>Điền bảng tuyến TRƯỚC khi chốt hợp đồng mặt bằng. Quy tắc bất di bất dịch: <strong>ít nhất một ngày trống sau mỗi ba điểm</strong>. Ngày đệm là thứ cứu cả tuyến khi gặp mưa hoặc hỏng thiết bị.</p>'
            },
            {
                kind: 'keyValue',
                title: 'Cột của bảng tuyến',
                rows: [
                    { label: 'Thứ tự điểm', value: 'Theo trình tự di chuyển, không theo thứ tự ưu tiên' },
                    { label: 'Tỉnh / Địa điểm', value: 'Tên cụ thể, có địa chỉ' },
                    { label: 'Ngày dựng / Ngày chạy', value: 'Tách riêng hai cột' },
                    { label: 'Quãng đường từ điểm trước', value: 'Km và giờ xe tải, không phải giờ xe con' },
                    { label: 'Điện', value: 'Công suất sẵn có; ghi rõ nếu cần máy phát' },
                    { label: 'Trạng thái giấy phép', value: 'Chưa nộp / Đang xử lý / Đã có' },
                    { label: 'Người phụ trách chặng', value: 'Một người duy nhất cho mỗi chặng' },
                    { label: 'Ghi chú rủi ro', value: 'Mùa mưa, lễ hội địa phương, hạn chế giờ xe tải' }
                ]
            },
            {
                kind: 'bulletGroups',
                title: 'Tiêu chí chọn điểm & Ghi nhận sau chặng',
                groups: [
                    {
                        title: 'Chọn điểm',
                        items: [
                            'Mật độ nhóm mục tiêu, không phải dân số tổng',
                            'Mặt bằng phẳng, có điện, được phép dựng qua đêm',
                            'Dưới nửa ngày xe tải từ điểm trước'
                        ]
                    },
                    {
                        title: 'Ghi nhận sau mỗi điểm',
                        items: [
                            'Thời gian dựng và tháo thực tế',
                            'Hạng mục hỏng hoặc thiếu',
                            'Lượt khách theo khung giờ',
                            'Việc gì nên làm khác ở điểm kế tiếp'
                        ]
                    }
                ]
            },
            { kind: 'linkedItems', title: 'Skill liên quan', links: [{ slug: SKILL.roadshow, label: 'Lập tuyến & Vận hành Roadshow' }] },
            noFileNote
        ]
    },

    {
        ...base,
        slug: SLUGS.proposal,
        coverImage: COVER.proposal,
        title: { vi: 'Khung Proposal sự kiện', en: 'Event Proposal Framework' },
        summary: {
            vi: 'Cấu trúc 9 phần cho bộ proposal, sắp theo thứ tự khách hàng thật sự đọc chứ không theo thứ tự bạn muốn kể.',
            en: 'A nine-part proposal structure ordered the way clients actually read, not the way you want to present.'
        },
        category: 'event',
        industries: ['fmcg', 'technology', 'finance'],
        objectives: ['product_launch', 'internal_corporate'],
        kpis: ['sales_conversion'],
        depth: 'basic',
        tags: ['template', 'proposal', 'pitch', 'deck'],
        metrics: [
            { label: 'Phần', value: '9' },
            { label: 'Slide gợi ý', value: '18–24' }
        ],
        sections: [
            {
                kind: 'richText',
                title: 'Dùng thế nào',
                html: '<p>Khách hàng đọc proposal theo thứ tự: <strong>họ hiểu vấn đề của tôi chưa → giải pháp là gì → bao nhiêu tiền</strong>. Ba phần đầu quyết định họ có đọc tiếp không. Đặt phần giới thiệu công ty ở cuối, không phải đầu.</p>'
            },
            {
                kind: 'steps',
                title: 'Chín phần theo thứ tự',
                steps: [
                    { title: 'Tóm tắt đề xuất', desc: '1 slide — nói được toàn bộ đề xuất trong 30 giây' },
                    { title: 'Hiểu về bài toán', desc: 'Chứng minh bạn đọc kỹ brief, nêu cả điều khách chưa nói ra' },
                    { title: 'Mục tiêu & KPI', desc: 'Đo được, thống nhất trước khi bàn ý tưởng' },
                    { title: 'Concept', desc: 'Một concept chính, tối đa một phương án thay thế' },
                    { title: 'Trải nghiệm', desc: 'Hành trình khách tham dự, từ lúc biết tới lúc ra về' },
                    { title: 'Triển khai', desc: 'Timeline, nhân sự, mặt bằng, rủi ro và cách xử lý' },
                    { title: 'Ngân sách', desc: 'Theo 7 nhóm BOQ, kèm giả định đi kèm giá' },
                    { title: 'Đo lường', desc: 'Đo bằng cách nào, ai đo, báo cáo khi nào' },
                    { title: 'Về chúng tôi', desc: 'Ngắn, chỉ những case thật sự liên quan' }
                ]
            },
            {
                kind: 'bulletGroups',
                title: 'Quy tắc trình bày',
                groups: [
                    {
                        title: 'Nên',
                        items: [
                            'Một slide một ý — tiêu đề slide là câu kết luận, không phải nhãn chủ đề',
                            'Số liệu nào cũng phải nêu được nguồn'
                        ]
                    },
                    {
                        title: 'Tránh',
                        items: [
                            'Mở đầu bằng lịch sử công ty',
                            'Ba concept ngang nhau — khách sẽ không chọn, sẽ hỏi làm lại'
                        ]
                    }
                ]
            },
            { kind: 'linkedItems', title: 'Skill liên quan', links: [{ slug: SKILL.budget, label: 'Bóc tách Ngân sách & BOQ sự kiện' }] },
            noFileNote
        ]
    },

    {
        ...base,
        slug: SLUGS.live,
        coverImage: COVER.live,
        title: { vi: 'Checklist sản xuất Livestream', en: 'Livestream Production Checklist' },
        summary: {
            vi: 'Kiểm tra theo ba mốc: chuẩn bị kỹ thuật, tổng duyệt hai chiều, và phương án khi hỏng.',
            en: 'Three checkpoints: technical prep, two-way rehearsal, and the failure playbook.'
        },
        category: 'digital_event',
        industries: ['technology', 'education', 'finance'],
        objectives: ['product_launch', 'brand_awareness'],
        kpis: ['attendance_reach', 'engagement'],
        depth: 'deep',
        tags: ['template', 'checklist', 'livestream', 'hybrid'],
        metrics: [
            { label: 'Mốc', value: '3' },
            { label: 'Mục kiểm', value: '13' }
        ],
        sections: [
            {
                kind: 'richText',
                title: 'Dùng thế nào',
                html: '<p>Mốc quan trọng nhất là <strong>tổng duyệt hai chiều</strong> — kiểm tra cả trải nghiệm trong phòng lẫn trên màn hình người xem online. Rất nhiều lỗi chỉ lộ ra khi nhìn từ phía khán giả online.</p>'
            },
            {
                kind: 'bulletGroups',
                title: 'Ba mốc',
                groups: [
                    {
                        title: 'Chuẩn bị kỹ thuật',
                        items: [
                            'Đường truyền riêng cho stream, không dùng chung wifi khách',
                            'Băng thông tải lên dự phòng gấp đôi bitrate dự kiến',
                            'Nguồn tiếng lấy từ bàn mixer, không lấy từ mic camera',
                            'Sơ đồ tín hiệu vẽ rõ từng sợi dây',
                            'Ghi hình cục bộ song song, không chỉ dựa vào bản trên nền tảng'
                        ]
                    },
                    {
                        title: 'Tổng duyệt hai chiều',
                        items: [
                            'Test stream thật lên kênh riêng tư đủ 20 phút',
                            'Xem thử trên điện thoại — slide có đọc được không',
                            'Camera không chắn tầm nhìn hàng ghế đầu',
                            'Ánh sáng cho stream không chói vào mắt khán giả tại chỗ',
                            'Người trực chat đã có kịch bản trả lời sẵn'
                        ]
                    },
                    {
                        title: 'Phương án khi hỏng',
                        items: [
                            'Mất mạng — chuyển sang đường dự phòng, ai bấm, mất bao lâu',
                            'Mất tiếng — mic dự phòng ở đâu, ai cầm',
                            'Mất hình — slide tĩnh xin lỗi đã chuẩn bị sẵn'
                        ]
                    }
                ]
            },
            { kind: 'linkedItems', title: 'Skill liên quan', links: [{ slug: SKILL.livestream, label: 'Sản xuất Livestream & Sự kiện hybrid' }] },
            noFileNote
        ]
    }
];

// ─── Chạy ──────────────────────────────────────────────────────────────────

const MODE = process.argv.includes('clean') ? 'clean'
    : process.argv.includes('--apply') ? 'apply'
        : 'dry';

await mongoose.connect(process.env.MONGODB_URI);

if (MODE === 'clean') {
    const result = await EventLibraryItem.deleteMany({ slug: { $in: Object.values(SLUGS) } });
    console.log(`Đã xoá ${result.deletedCount} template mẫu.`);
} else {
    const skillCount = await EventLibraryItem.countDocuments({ slug: { $in: Object.values(SKILL) } });
    if (skillCount < Object.keys(SKILL).length) {
        console.log(`⚠ Mới có ${skillCount}/${Object.keys(SKILL).length} skill trong DB — chạy seed-event-library-skills.mjs --apply trước để liên kết không bị gãy.`);
    }

    let created = 0;
    let skipped = 0;
    for (const item of items) {
        if (await EventLibraryItem.exists({ slug: item.slug })) {
            console.log(`  bỏ qua (đã có): ${item.slug}`);
            skipped++;
            continue;
        }
        console.log(`  ${MODE === 'apply' ? 'tạo' : 'sẽ tạo'}: ${item.slug} — ${item.sections.length} khối`);
        if (MODE === 'apply') {
            await EventLibraryItem.create(item);
            created++;
        }
    }
    console.log(MODE === 'apply'
        ? `Xong: tạo ${created}, bỏ qua ${skipped}. (Chưa có file đính kèm — xem ghi chú đầu file.)`
        : `Dry-run: ${items.length - skipped} mục sẽ được tạo. Chạy lại với --apply để ghi.`);
}

await mongoose.disconnect();
