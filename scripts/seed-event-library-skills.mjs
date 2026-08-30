/**
 * Bộ skill mẫu cho Thư viện tri thức sự kiện — nội dung biên tập của web
 * (`ownership: 'platform'`, luôn công khai).
 *
 *   node scripts/seed-event-library-skills.mjs           # dry-run, liệt kê sẽ tạo gì
 *   node scripts/seed-event-library-skills.mjs --apply   # ghi vào DB
 *   node scripts/seed-event-library-skills.mjs clean     # xoá đúng 6 mục này
 *
 * Slug cố định (không có hậu tố ngẫu nhiên) nên chạy lại là idempotent: mục đã
 * có thì bỏ qua, không tạo bản sao. Sáu skill liên kết chéo nhau qua khối
 * `linkedItems` bằng chính các slug này.
 *
 * `verification` để 'unverified': đây là hướng dẫn nghiệp vụ do biên tập viết,
 * chưa qua quy trình xác thực dữ liệu nào. Đổi sang 'verified' trong trình đăng
 * sau khi có người rà lại.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import EventLibraryItem from '../server/models/EventLibraryItem.js';

const SLUGS = {
    booth: 'skill-thiet-ke-booth-va-luong-di-chuyen',
    stage: 'skill-kich-ban-san-khau-va-dieu-phoi-cue',
    activation: 'skill-thiet-ke-co-che-activation',
    roadshow: 'skill-lap-tuyen-va-van-hanh-roadshow',
    budget: 'skill-boc-tach-ngan-sach-va-boq-su-kien',
    livestream: 'skill-san-xuat-livestream-va-su-kien-hybrid'
};


/**
 * Ảnh bìa sinh bằng skill `delegate --type=image` của hybrid-ai-skills (Gemini image
 * qua Antigravity) rồi đẩy lên Cloudinary folder `event-library` bằng unsigned preset —
 * đúng quy ước ảnh bìa của dự án. Nguồn JPG không commit vào repo.
 */
const COVER = {
    'skill-thiet-ke-booth-va-luong-di-chuyen': 'https://res.cloudinary.com/dzchj4ysj/image/upload/v1788063984/event-library/um4pxyhriwlej3l5mdiw.jpg',
    'skill-kich-ban-san-khau-va-dieu-phoi-cue': 'https://res.cloudinary.com/dzchj4ysj/image/upload/v1788063987/event-library/iindcvjoqeznv8ftzek5.jpg',
    'skill-thiet-ke-co-che-activation': 'https://res.cloudinary.com/dzchj4ysj/image/upload/v1788063989/event-library/epk4uhviileqoqbd8aah.jpg',
    'skill-lap-tuyen-va-van-hanh-roadshow': 'https://res.cloudinary.com/dzchj4ysj/image/upload/v1788063992/event-library/aghgvwmp6qfykhcnljrk.jpg',
    'skill-boc-tach-ngan-sach-va-boq-su-kien': 'https://res.cloudinary.com/dzchj4ysj/image/upload/v1788063995/event-library/ksscgihw05rexe2ehtmd.jpg',
    'skill-san-xuat-livestream-va-su-kien-hybrid': 'https://res.cloudinary.com/dzchj4ysj/image/upload/v1788063998/event-library/hmfhhinc19cnlcbnht4y.jpg',
};

/** Phần chung của mọi skill trong bộ này. */
const base = {
    itemType: 'skill',
    ownership: 'platform',
    visibility: 'public',
    owner: null,
    verification: 'unverified',
    sourceName: 'Alpha Studio — Biên tập nội bộ',
    authorName: 'Alpha Studio',
    origin: { kind: 'manual', refId: null },
    stats: { views: 0, uses: 0 }
};

const items = [
    {
        ...base,
        slug: SLUGS.booth,
        coverImage: COVER[SLUGS.booth],
        title: {
            vi: 'Thiết kế Booth & Luồng di chuyển',
            en: 'Booth Design & Visitor Flow'
        },
        summary: {
            vi: 'Bố trí booth sao cho khách tự đi vào, dừng lại đúng chỗ, và không tắc ở giờ cao điểm.',
            en: 'Lay out a booth so visitors walk in on their own, stop where you want them to, and never jam at peak hour.'
        },
        category: 'booth_exhibition',
        industries: ['fmcg', 'technology', 'retail_mall'],
        objectives: ['brand_awareness', 'sales_activation'],
        kpis: ['attendance_reach', 'engagement'],
        depth: 'deep',
        tags: ['booth', 'exhibition', 'traffic-flow', 'layout'],
        metrics: [
            { label: 'Số bước', value: '5' },
            { label: 'Thông số', value: '6' },
            { label: 'Độ khó', value: 'Vừa' }
        ],
        sections: [
            {
                kind: 'richText',
                title: 'Vấn đề thật của booth',
                html: '<p>Phần lớn booth hỏng không phải vì thiết kế xấu, mà vì <strong>khách không biết đi vào lối nào</strong>. Ba lỗi lặp lại nhiều nhất: đặt bàn lễ tân chắn ngay cửa vào, dồn toàn bộ điểm chạm vào một góc, và không chừa chỗ cho hàng chờ.</p><p>Thiết kế booth là bài toán luồng người trước, bài toán thẩm mỹ sau.</p>'
            },
            {
                kind: 'keyValue',
                title: 'Thông số nền hay dùng',
                rows: [
                    { label: 'Lối đi chính trong booth', value: 'Tối thiểu 1.2m; 1.8m nếu dự kiến có hàng chờ' },
                    { label: 'Chiều cao backdrop', value: '2.4m – 3.0m tuỳ trần hội trường; kiểm tra trần thật trước khi chốt' },
                    { label: 'Tỷ lệ trưng bày / lưu thông', value: 'Khoảng 60/40 — dưới 40% lưu thông là bắt đầu tắc' },
                    { label: 'Tầm mắt trung bình', value: '1.5m — thông điệp chính nằm trong dải 1.2m–1.7m' },
                    { label: 'Khoảng đọc backdrop', value: 'Cỡ chữ ≈ 1/30 khoảng cách đọc dự kiến' },
                    { label: 'Điểm chạm mỗi khách', value: '2–3 là vừa; nhiều hơn thì khách bỏ giữa chừng' }
                ]
            },
            {
                kind: 'steps',
                title: 'Quy trình thiết kế',
                steps: [
                    { title: 'Đọc mặt bằng', desc: 'Xác định hướng người đổ vào, cột, cửa thoát hiểm, vị trí điện' },
                    { title: 'Vạch luồng', desc: 'Vẽ đường đi mong muốn trước khi vẽ bất kỳ vách nào' },
                    { title: 'Đặt điểm dừng', desc: 'Mỗi điểm chạm là một lý do để khách dừng lại' },
                    { title: 'Dựng khối 3D', desc: 'Kiểm tra tầm nhìn từ lối vào và từ hai bên' },
                    { title: 'Rà vận hành', desc: 'Đủ chỗ cho nhân sự, kho hàng, chỗ sạc, chỗ để đồ khách' }
                ]
            },
            {
                kind: 'bulletGroups',
                title: 'Kinh nghiệm triển khai',
                groups: [
                    {
                        title: 'Nên làm',
                        items: [
                            'Mở ít nhất hai mặt tiếp cận nếu booth ở góc',
                            'Đặt thông điệp lớn nhất ở mặt khách nhìn thấy từ xa nhất',
                            'Chừa một vùng đệm ngay cửa để khách không bị dồn'
                        ]
                    },
                    {
                        title: 'Nên tránh',
                        items: [
                            'Bàn lễ tân chắn chính diện lối vào',
                            'Đặt màn hình lớn ở nơi phải đứng lùi mới xem được nhưng không có chỗ lùi',
                            'Ghép quá nhiều hoạt động vào cùng một góc booth'
                        ]
                    },
                    {
                        title: 'Kiểm tra trước ngày mở',
                        items: [
                            'Đi thử toàn bộ luồng như một khách lạ',
                            'Đo lại lối đi sau khi hàng hoá đã vào booth',
                            'Xác nhận vị trí ổ điện khớp bản vẽ'
                        ]
                    }
                ]
            },
            {
                kind: 'linkedItems',
                title: 'Dùng kèm',
                links: [
                    { slug: SLUGS.activation, label: 'Thiết kế cơ chế Activation' },
                    { slug: SLUGS.budget, label: 'Bóc tách ngân sách & BOQ' }
                ]
            }
        ]
    },

    {
        ...base,
        slug: SLUGS.stage,
        coverImage: COVER[SLUGS.stage],
        title: {
            vi: 'Kịch bản sân khấu & Điều phối cue',
            en: 'Show Flow & Cue Management'
        },
        summary: {
            vi: 'Biến kịch bản chương trình thành bảng cue mà đạo diễn, âm thanh, ánh sáng và màn LED cùng chạy được.',
            en: 'Turn a run-of-show into a cue sheet that the director, audio, lighting and LED crew can all run from.'
        },
        category: 'stage_production',
        industries: ['technology', 'finance', 'education'],
        objectives: ['product_launch', 'internal_corporate'],
        kpis: ['brand_recall', 'engagement'],
        depth: 'deep',
        tags: ['stage', 'cue-sheet', 'run-of-show', 'production'],
        metrics: [
            { label: 'Số bước', value: '6' },
            { label: 'Cột cue', value: '7' },
            { label: 'Độ khó', value: 'Cao' }
        ],
        sections: [
            {
                kind: 'richText',
                title: 'Bảng cue là gì',
                html: '<p>Bảng cue là bản dịch kịch bản sang <strong>ngôn ngữ vận hành</strong>: ai bấm gì, vào lúc nào, theo hiệu lệnh của ai. Kịch bản kể chuyện cho khách; bảng cue kể chuyện cho ê-kíp.</p><p>Không có bảng cue thì mọi chuyển cảnh đều phụ thuộc trí nhớ của một người.</p>'
            },
            {
                kind: 'keyValue',
                title: 'Bảy cột tối thiểu của một bảng cue',
                rows: [
                    { label: 'Cue #', value: 'Số thứ tự, không đánh lại giữa chừng khi chèn cue mới — dùng 12.5' },
                    { label: 'Thời điểm', value: 'Mốc giờ dự kiến, cập nhật sau tổng duyệt' },
                    { label: 'Nội dung', value: 'Chuyện gì đang diễn ra trên sân khấu' },
                    { label: 'Hiệu lệnh', value: 'Ai gọi cue này — thường là đạo diễn sân khấu' },
                    { label: 'LED / Màn', value: 'Tên file hoặc slide, đúng như trên máy phát' },
                    { label: 'Âm thanh', value: 'Track, mic nào mở, mic nào tắt' },
                    { label: 'Ánh sáng', value: 'Preset hoặc mô tả trạng thái' }
                ]
            },
            {
                kind: 'steps',
                title: 'Quy trình dựng',
                steps: [
                    { title: 'Chốt kịch bản', desc: 'Không dựng cue trên kịch bản còn đang sửa nội dung' },
                    { title: 'Chia phân đoạn', desc: 'Cắt theo chuyển cảnh, không cắt theo phút' },
                    { title: 'Gán cue', desc: 'Mỗi thay đổi nhìn thấy hoặc nghe thấy là một cue' },
                    { title: 'Đặt tên file', desc: 'Tên file trên máy phát phải trùng tuyệt đối với tên trong bảng' },
                    { title: 'Tổng duyệt', desc: 'Chạy đủ cue, ghi lại thời gian thật thay cho dự kiến' },
                    { title: 'Khoá bản', desc: 'In ra, phát cho từng bộ phận, mọi sửa sau đó phải ghi tay và thông báo' }
                ]
            },
            {
                kind: 'quote',
                title: '',
                quote: 'Màn LED không kể chuyện thay MC. Nó làm cho câu chuyện của MC có trọng lượng.',
                quoteBy: 'Nguyên tắc nền tảng'
            },
            {
                kind: 'bulletGroups',
                title: 'Bẫy thường gặp',
                groups: [
                    {
                        title: 'Trước sự kiện',
                        items: [
                            'Nội dung LED đổi vào phút chót nhưng bảng cue không đổi theo',
                            'Hai bản kịch bản khác nhau đang lưu hành giữa các bộ phận'
                        ]
                    },
                    {
                        title: 'Trong sự kiện',
                        items: [
                            'Không có người duy nhất gọi cue — hai người cùng gọi là hỏng',
                            'Mic của MC bật muộn hơn cue hình một nhịp'
                        ]
                    },
                    {
                        title: 'Sau sự kiện',
                        items: [
                            'Không ai ghi lại cue thực tế đã chạy khác dự kiến chỗ nào',
                            'File nội dung không được lưu lại theo đúng tên đã dùng'
                        ]
                    }
                ]
            },
            {
                kind: 'linkedItems',
                title: 'Dùng kèm',
                links: [
                    { slug: SLUGS.livestream, label: 'Sản xuất Livestream & sự kiện hybrid' }
                ]
            }
        ]
    },

    {
        ...base,
        slug: SLUGS.activation,
        coverImage: COVER[SLUGS.activation],
        title: {
            vi: 'Thiết kế cơ chế Activation',
            en: 'Activation Mechanic Design'
        },
        summary: {
            vi: 'Thiết kế trò chơi và cơ chế đổi quà sao cho khách hiểu trong 5 giây và không tắc ở khâu phát quà.',
            en: 'Design games and reward mechanics people grasp in five seconds — and that do not jam at the prize desk.'
        },
        category: 'activation',
        industries: ['fmcg', 'beauty', 'fnb'],
        objectives: ['sales_activation', 'customer_loyalty'],
        kpis: ['engagement', 'leads_database'],
        depth: 'basic',
        tags: ['activation', 'game-mechanic', 'sampling', 'gift'],
        metrics: [
            { label: 'Số bước', value: '4' },
            { label: 'Tiêu chí', value: '5' },
            { label: 'Độ khó', value: 'Thấp' }
        ],
        sections: [
            {
                kind: 'richText',
                title: 'Nguyên tắc 5 giây',
                html: '<p>Khách đi ngang booth cho bạn khoảng <strong>5 giây</strong> để hiểu: chơi cái gì, mất bao lâu, được gì. Cơ chế nào cần giải thích quá 5 giây thì phải đơn giản lại, không phải in thêm bảng hướng dẫn.</p>'
            },
            {
                kind: 'keyValue',
                title: 'Năm tiêu chí sàng lọc một cơ chế',
                rows: [
                    { label: 'Hiểu ngay', value: 'Nhìn là biết chơi gì, không cần đọc' },
                    { label: 'Đủ ngắn', value: '30–90 giây mỗi lượt cho activation tại điểm bán' },
                    { label: 'Không tắc', value: 'Thời gian phát quà phải ngắn hơn thời gian chơi' },
                    { label: 'Có lý do quay lại', value: 'Hoặc có lý do kể lại cho người khác' },
                    { label: 'Gắn với sản phẩm', value: 'Nếu bỏ thương hiệu ra mà trò chơi vẫn nguyên vẹn thì cơ chế đang rỗng' }
                ]
            },
            {
                kind: 'steps',
                title: 'Quy trình',
                steps: [
                    { title: 'Chốt hành vi mong muốn', desc: 'Muốn khách dùng thử, để lại data, hay chia sẻ?' },
                    { title: 'Phác 3 cơ chế', desc: 'Luôn có phương án dự phòng khi cơ chế chính không được duyệt' },
                    { title: 'Chạy thử nội bộ', desc: 'Bấm giờ thật, đo cả khâu phát quà' },
                    { title: 'Chuẩn hoá kịch bản nhân sự', desc: 'Câu mời, câu hướng dẫn, câu xử lý khi hết quà' }
                ]
            },
            {
                kind: 'bulletGroups',
                title: 'Vận hành',
                groups: [
                    {
                        title: 'Chuẩn bị',
                        items: [
                            'Quà chia sẵn theo khung giờ, không để nhân sự tự ước lượng',
                            'Có kịch bản riêng cho tình huống hết quà sớm'
                        ]
                    },
                    {
                        title: 'Tại chỗ',
                        items: [
                            'Một người chỉ làm một việc: mời, hướng dẫn, hoặc phát quà',
                            'Đếm lượt chơi theo giờ để biết giờ cao điểm thật'
                        ]
                    }
                ]
            },
            {
                kind: 'linkedItems',
                title: 'Dùng kèm',
                links: [
                    { slug: SLUGS.booth, label: 'Thiết kế Booth & Luồng di chuyển' },
                    { slug: SLUGS.roadshow, label: 'Lập tuyến & vận hành Roadshow' }
                ]
            }
        ]
    },

    {
        ...base,
        slug: SLUGS.roadshow,
        coverImage: COVER[SLUGS.roadshow],
        title: {
            vi: 'Lập tuyến & Vận hành Roadshow',
            en: 'Roadshow Route Planning & Operations'
        },
        summary: {
            vi: 'Chọn điểm dừng, xếp lịch di chuyển và chuẩn hoá bộ kit sao cho đoàn chạy được nhiều tỉnh mà không rã.',
            en: 'Pick stops, schedule the convoy and standardise the kit so a multi-province tour does not fall apart.'
        },
        category: 'roadshow',
        industries: ['automotive', 'fmcg', 'technology'],
        objectives: ['brand_awareness', 'product_launch'],
        kpis: ['attendance_reach', 'leads_database'],
        depth: 'deep',
        tags: ['roadshow', 'logistics', 'route', 'tour'],
        metrics: [
            { label: 'Số bước', value: '5' },
            { label: 'Tiêu chí', value: '5' },
            { label: 'Độ khó', value: 'Cao' }
        ],
        sections: [
            {
                kind: 'richText',
                title: 'Roadshow hỏng ở đâu',
                html: '<p>Roadshow hiếm khi hỏng vì ý tưởng. Nó hỏng vì <strong>lịch di chuyển không có đệm</strong>, vì mỗi điểm lại setup một kiểu, và vì đoàn kiệt sức ở tỉnh thứ tư.</p><p>Phần khó nhất của roadshow là phần lặp lại được.</p>'
            },
            {
                kind: 'keyValue',
                title: 'Chọn điểm dừng',
                rows: [
                    { label: 'Mật độ nhóm mục tiêu', value: 'Quan trọng hơn dân số tổng của tỉnh' },
                    { label: 'Mặt bằng', value: 'Có sẵn điện 3 pha, mặt phẳng, được phép dựng qua đêm' },
                    { label: 'Quãng đường giữa hai điểm', value: 'Giữ dưới nửa ngày xe tải; xa hơn thì phải chèn ngày trống' },
                    { label: 'Thời điểm trong tuần', value: 'Điểm ngoài trời tránh trùng lịch mưa mùa của khu vực' },
                    { label: 'Thủ tục địa phương', value: 'Thời gian xin phép khác nhau theo tỉnh — hỏi trước khi chốt tuyến' }
                ]
            },
            {
                kind: 'steps',
                title: 'Quy trình',
                steps: [
                    { title: 'Vẽ tuyến nháp', desc: 'Ưu tiên đường đi liền mạch, tránh quay đầu' },
                    { title: 'Khảo sát thực địa', desc: 'Ảnh mặt bằng, vị trí điện, lối xe vào' },
                    { title: 'Chuẩn hoá kit', desc: 'Một bộ thiết bị dựng được ở mọi điểm, không tuỳ biến từng nơi' },
                    { title: 'Lịch có đệm', desc: 'Ít nhất một ngày trống sau mỗi ba điểm' },
                    { title: 'Bàn giao theo chặng', desc: 'Mỗi chặng có một người chịu trách nhiệm duy nhất' }
                ]
            },
            {
                kind: 'bulletGroups',
                title: 'Bộ kit tiêu chuẩn',
                groups: [
                    {
                        title: 'Bắt buộc mang theo',
                        items: [
                            'Bản vẽ dựng và ảnh tham chiếu in sẵn, không phụ thuộc mạng',
                            'Bộ phụ kiện dự phòng: dây, ổ cắm, bulông, băng dính vải',
                            'Danh sách liên hệ địa phương từng điểm'
                        ]
                    },
                    {
                        title: 'Ghi lại sau mỗi điểm',
                        items: [
                            'Thời gian dựng và tháo thực tế',
                            'Hạng mục nào hỏng hoặc thiếu',
                            'Lượt khách theo khung giờ'
                        ]
                    }
                ]
            },
            {
                kind: 'linkedItems',
                title: 'Dùng kèm',
                links: [
                    { slug: SLUGS.activation, label: 'Thiết kế cơ chế Activation' },
                    { slug: SLUGS.budget, label: 'Bóc tách ngân sách & BOQ' }
                ]
            }
        ]
    },

    {
        ...base,
        slug: SLUGS.budget,
        coverImage: COVER[SLUGS.budget],
        title: {
            vi: 'Bóc tách Ngân sách & BOQ sự kiện',
            en: 'Event Budgeting & BOQ Breakdown'
        },
        summary: {
            vi: 'Cấu trúc bảng BOQ để so sánh được giữa các nhà thầu và không phát sinh vào phút chót.',
            en: 'Structure a BOQ so vendor quotes are comparable and last-minute overruns stop happening.'
        },
        category: 'event',
        industries: ['fmcg', 'technology', 'finance', 'retail_mall'],
        objectives: ['internal_corporate', 'product_launch'],
        kpis: ['sales_conversion'],
        depth: 'benchmark',
        tags: ['budget', 'boq', 'procurement', 'vendor'],
        metrics: [
            { label: 'Nhóm mục', value: '7' },
            { label: 'Số bước', value: '4' },
            { label: 'Độ khó', value: 'Vừa' }
        ],
        sections: [
            {
                kind: 'richText',
                title: 'Vì sao báo giá không so sánh được',
                html: '<p>Ba nhà thầu gửi ba bảng khác cấu trúc thì không thể so. Bảng rẻ nhất thường là bảng <strong>thiếu hạng mục</strong>, không phải bảng tối ưu nhất.</p><p>Giải pháp: phát ra một khung BOQ trống và yêu cầu mọi nhà thầu điền vào đúng khung đó.</p>'
            },
            {
                kind: 'keyValue',
                title: 'Bảy nhóm hạng mục của khung BOQ',
                rows: [
                    { label: 'Mặt bằng', value: 'Thuê địa điểm, phí dịch vụ, điện nước, phí ngoài giờ' },
                    { label: 'Thi công', value: 'Vật tư, nhân công dựng, tháo, vận chuyển' },
                    { label: 'Thiết bị', value: 'Âm thanh, ánh sáng, màn hình, máy phát điện dự phòng' },
                    { label: 'Nội dung', value: 'Thiết kế, sản xuất video, in ấn' },
                    { label: 'Nhân sự', value: 'Ê-kíp vận hành, MC, PG, an ninh, y tế' },
                    { label: 'Vận hành', value: 'Ăn uống ê-kíp, đi lại, lưu trú, bảo hiểm' },
                    { label: 'Dự phòng', value: 'Một dòng riêng, không giấu trong các nhóm trên' }
                ]
            },
            {
                kind: 'steps',
                title: 'Quy trình',
                steps: [
                    { title: 'Phát khung trống', desc: 'Mọi nhà thầu nhận cùng một file, cùng danh mục dòng' },
                    { title: 'Khoá phạm vi', desc: 'Ghi rõ cái gì KHÔNG nằm trong báo giá' },
                    { title: 'So theo dòng', desc: 'Chênh lệch lớn ở một dòng nghĩa là hai bên hiểu khác nhau — hỏi lại' },
                    { title: 'Chốt và ghi giả định', desc: 'Mọi con số kèm giả định; giả định đổi thì giá đổi' }
                ]
            },
            {
                kind: 'bulletGroups',
                title: 'Nguồn phát sinh hay bị bỏ sót',
                groups: [
                    {
                        title: 'Mặt bằng',
                        items: [
                            'Phí thi công ngoài giờ hành chính',
                            'Phí đổ rác và hoàn trả mặt bằng'
                        ]
                    },
                    {
                        title: 'Kỹ thuật',
                        items: [
                            'Máy phát điện dự phòng và nhiên liệu',
                            'Nâng tải điện nếu thiết bị vượt công suất sẵn có'
                        ]
                    },
                    {
                        title: 'Con người',
                        items: [
                            'Ca đêm khi lịch dựng bị đẩy muộn',
                            'Ăn uống và đi lại của ê-kíp ngoài tỉnh'
                        ]
                    }
                ]
            },
            {
                kind: 'linkedItems',
                title: 'Dùng kèm',
                links: [
                    { slug: SLUGS.booth, label: 'Thiết kế Booth & Luồng di chuyển' },
                    { slug: SLUGS.roadshow, label: 'Lập tuyến & vận hành Roadshow' }
                ]
            }
        ]
    },

    {
        ...base,
        slug: SLUGS.livestream,
        coverImage: COVER[SLUGS.livestream],
        title: {
            vi: 'Sản xuất Livestream & Sự kiện hybrid',
            en: 'Livestream & Hybrid Event Production'
        },
        summary: {
            vi: 'Chạy đồng thời khán giả tại chỗ và khán giả online mà không hy sinh bên nào.',
            en: 'Run the in-room audience and the online audience at once without shortchanging either.'
        },
        category: 'digital_event',
        industries: ['technology', 'education', 'finance'],
        objectives: ['brand_awareness', 'internal_corporate'],
        kpis: ['attendance_reach', 'engagement'],
        depth: 'deep',
        tags: ['livestream', 'hybrid', 'streaming', 'broadcast'],
        metrics: [
            { label: 'Số bước', value: '5' },
            { label: 'Kiểm tra', value: '6' },
            { label: 'Độ khó', value: 'Cao' }
        ],
        sections: [
            {
                kind: 'richText',
                title: 'Hai khán giả, hai trải nghiệm',
                html: '<p>Sai lầm phổ biến nhất của hybrid là <strong>đặt một máy quay ở cuối phòng rồi gọi đó là livestream</strong>. Khán giả online không thấy được thứ khán giả tại chỗ thấy, và ngược lại.</p><p>Hybrid làm đúng nghĩa là dựng hai kịch bản song song dùng chung một nội dung.</p>'
            },
            {
                kind: 'keyValue',
                title: 'Thông số kỹ thuật cần chốt sớm',
                rows: [
                    { label: 'Đường truyền', value: 'Có dây riêng cho stream, không dùng chung wifi khách' },
                    { label: 'Băng thông tải lên', value: 'Dự phòng gấp đôi bitrate dự kiến' },
                    { label: 'Nguồn tiếng', value: 'Lấy từ bàn mixer, không lấy từ mic camera' },
                    { label: 'Tỷ lệ khung hình', value: 'Chuẩn bị bản 16:9 cho stream và bản dọc nếu có kênh dọc' },
                    { label: 'Ghi hình dự phòng', value: 'Ghi cục bộ song song, không chỉ dựa vào bản trên nền tảng' },
                    { label: 'Người trực chat', value: 'Một người chuyên trách, không kiêm việc khác' }
                ]
            },
            {
                kind: 'steps',
                title: 'Quy trình',
                steps: [
                    { title: 'Chốt kênh phát', desc: 'Mỗi nền tảng có giới hạn bitrate và tỷ lệ khác nhau' },
                    { title: 'Dựng sơ đồ tín hiệu', desc: 'Từ nguồn hình/tiếng đến máy encode, ghi rõ từng sợi dây' },
                    { title: 'Chạy thử đủ đường', desc: 'Test stream thật lên kênh riêng tư, không test bằng cách nói suông' },
                    { title: 'Tổng duyệt hai chiều', desc: 'Kiểm tra cả trải nghiệm tại chỗ lẫn trên màn hình người xem' },
                    { title: 'Chuẩn bị phương án hỏng', desc: 'Mất mạng, mất tiếng, mất hình — mỗi trường hợp một hành động cụ thể' }
                ]
            },
            {
                kind: 'bulletGroups',
                title: 'Đừng quên',
                groups: [
                    {
                        title: 'Cho khán giả online',
                        items: [
                            'Có hình toàn cảnh xen kẽ, không chỉ cận mặt diễn giả',
                            'Slide phải đọc được trên màn điện thoại'
                        ]
                    },
                    {
                        title: 'Cho khán giả tại chỗ',
                        items: [
                            'Không để camera chắn tầm nhìn hàng ghế đầu',
                            'Ánh sáng cho stream không được chói vào mắt khán giả'
                        ]
                    }
                ]
            },
            {
                kind: 'linkedItems',
                title: 'Dùng kèm',
                links: [
                    { slug: SLUGS.stage, label: 'Kịch bản sân khấu & Điều phối cue' }
                ]
            }
        ]
    }
];

// ─── Chạy ──────────────────────────────────────────────────────────────────

const MODE = process.argv.includes('clean') ? 'clean'
    : process.argv.includes('--apply') ? 'apply'
        : 'dry';

await mongoose.connect(process.env.MONGODB_URI);
const allSlugs = Object.values(SLUGS);

if (MODE === 'clean') {
    const result = await EventLibraryItem.deleteMany({ slug: { $in: allSlugs } });
    console.log(`Đã xoá ${result.deletedCount} skill mẫu.`);
} else {
    let created = 0;
    let skipped = 0;
    for (const item of items) {
        const exists = await EventLibraryItem.exists({ slug: item.slug });
        if (exists) {
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
        ? `Xong: tạo ${created}, bỏ qua ${skipped}.`
        : `Dry-run: ${items.length - skipped} mục sẽ được tạo. Chạy lại với --apply để ghi.`);
}

await mongoose.disconnect();
