// お店ごとに書き換える設定ファイル。
// ここだけ編集すれば、占い・キャラ・質問の選択肢・投稿先が変わります。
window.SHOP_CONFIG = {
  shopName: "Sweet Season ririo",

  // Googleの口コミ投稿ページ。
  // いまは Google マップでお店を開くリンクです（開いたあと「クチコミを書く」をタップ）。
  // Googleビジネスプロフィールの「クチコミを依頼」で出るURL（https://g.page/r/XXXX/review）に置き換えると、
  // 星をつける画面がいきなり開くので、さらに投稿しやすくなります。
  gbpReviewUrl: "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent("Sweet Season ririo 宮城県多賀城市丸山1-14-7"),
  gbpDirect: false, // 上を g.page/r/.../review に置き換えたら true に

  // AI中継サーバー（worker/ をデプロイしたURL）。空のままなら、AIなしの質問・文章作成で動きます。
  // 例: https://kuchikomi-ai.example.workers.dev
  aiEndpoint: "",

  // アンケート結果の送り先（Googleスプレッドシート用のApps Script URL など）。空なら送信しません。
  feedbackEndpoint: "",

  // 商品 = 占いキャラ。rarity: N / R / SR / SSR（出やすさ）
  // textures / flavors は、その商品を食べた人に出す選択肢です。
  // textures は「〇〇で、」、flavors は「〇〇が印象的でした」とつながる言葉にしてください。
  products: [
    {
      id: "cookie", name: "クッキー缶", chara: "クッキー缶ファミリー", emoji: "🍪", color: "#c98b4b", rarity: "N",
      keyword: "さくさく",
      textures: ["さくさく", "ほろほろ", "ざくざく", "しっかり噛みごたえ"],
      flavors: ["バターの香り", "種類ごとに違う味", "やさしい甘さ", "かわいい見た目"],
      fortune: "にぎやかな場所に運が集まる日。久しぶりの人に連絡してみて。",
    },
    {
      id: "lemon", name: "レモンクッキー", chara: "レモンちゃん", emoji: "🍋", color: "#f2d64b", rarity: "N",
      keyword: "爽やか",
      textures: ["さくさく", "ほろっと軽い", "しっとりめ", "口どけがいい"],
      flavors: ["レモンの爽やかさ", "甘酸っぱさ", "アイシングの甘さ", "かわいい見た目"],
      fortune: "気分をリセットすると、いい流れがやってくる日。窓をあけて深呼吸を。",
    },
    {
      id: "pudding", name: "琥珀卵プリン", chara: "こはく姫", emoji: "🍮", color: "#f0b84a", rarity: "R",
      keyword: "卵のコク",
      textures: ["なめらか", "とろとろ", "しっかりかため", "ぷるぷる"],
      flavors: ["濃厚な卵のコク", "カラメルのほろ苦さ", "やさしい甘さ", "きれいな卵の色"],
      fortune: "ていねいに選んだものが、あなたを輝かせる日。こだわりは手放さないで。",
    },
    {
      id: "bavarois", name: "ババロア", chara: "ババロア男爵", emoji: "🍨", color: "#efd9b4", rarity: "N",
      keyword: "ふるふる",
      textures: ["ふるふる", "なめらか", "ふんわり軽い", "ひんやり"],
      flavors: ["ミルクのやさしさ", "バニラの香り", "やさしい甘さ", "ソースとの相性"],
      fortune: "やわらかい対応が、思わぬ味方をつくる日。笑顔をひとつ多めに。",
    },
    {
      id: "roll", name: "いちごのロールケーキ", chara: "いちごロールくん", emoji: "🍓", color: "#ef8a9a", rarity: "R",
      keyword: "ふわふわ",
      textures: ["スポンジがふわふわ", "しっとりスポンジ", "クリームが軽い", "ボリューム満点"],
      flavors: ["いちごの甘酸っぱさ", "ミルキーなクリーム", "卵の風味", "華やかな見た目"],
      fortune: "まわりと手をつなぐほど運が巻き上がる日。誰かを誘ってみて。",
    },
    {
      id: "order", name: "オーダーケーキ", chara: "デコレーション職人", emoji: "🎂", color: "#b69ae0", rarity: "SR",
      keyword: "世界にひとつ",
      textures: ["スポンジがふわふわ", "しっとりスポンジ", "クリームがなめらか", "ボリューム満点"],
      flavors: ["イメージ通りのデザイン", "ていねいな仕上がり", "やさしい甘さ", "フルーツの彩り"],
      fortune: "あなたらしさが主役になる日。お祝いごとや、新しいスタートに追い風。",
    },
    {
      id: "gift", name: "蔵王琥珀卵とお菓子の詰合せ", chara: "琥珀たまご仙人", emoji: "🥚", color: "#e8a33d", rarity: "SSR",
      keyword: "琥珀色",
      textures: ["いろいろな食感", "さくさく", "なめらか", "しっとり"],
      flavors: ["卵の濃厚なコク", "素材のよさ", "やさしい甘さ", "ギフト向きの見た目"],
      fortune: "めったに出会えない幸運の日！蔵王の恵みのように、じっくり実った努力が報われます。",
    },
    // ---------- 季節限定（seasons に書いた期間だけ登場します） ----------
    {
      id: "montblanc", name: "栗のモンブラン", chara: "モンブラン博士", emoji: "🌰", color: "#a8754a", rarity: "SR", seasons: ["autumn"],
      keyword: "栗の香り",
      textures: ["クリームがなめらか", "メレンゲがさくっ", "ねっとり濃厚", "ふんわり軽い"],
      flavors: ["栗の香り", "栗のやさしい甘さ", "洋酒の香り", "上品な見た目"],
      fortune: "じっくり積み上げてきたことが、ほっくり実を結ぶ日。急がず、味わって。",
    },
    {
      id: "marron", name: "栗の焼き菓子", chara: "マロン兄さん", emoji: "🌰", color: "#c08a52", rarity: "R", seasons: ["autumn"],
      keyword: "ほっくり",
      textures: ["しっとり", "ほっくり", "ごろっと栗入り", "食べごたえ十分"],
      flavors: ["栗の風味", "バターの香り", "渋皮の香ばしさ", "やさしい甘さ"],
      fortune: "トゲのある出来事の中に、甘い実が隠れている日。もう一歩だけ踏み込んで。",
    },
    {
      id: "pumpkin", name: "かぼちゃのお菓子", chara: "かぼちゃプリンちゃん", emoji: "🎃", color: "#f08a24", rarity: "R", seasons: ["autumn", "halloween"],
      keyword: "ほくほく",
      textures: ["なめらか", "ほくほく", "しっとり", "ねっとり濃厚"],
      flavors: ["かぼちゃの甘み", "シナモンの香り", "カラメルのほろ苦さ", "秋らしい見た目"],
      fortune: "変身のチャンスがある日。いつもと違う服や髪型が運を呼びます。",
    },
    {
      id: "halloween-cookie", name: "ハロウィンクッキー", chara: "おばけクッキー団", emoji: "👻", color: "#8a5bd1", rarity: "R", seasons: ["halloween"],
      keyword: "かわいいおばけ",
      textures: ["さくさく", "ほろほろ", "アイシングがかりっ", "しっかり噛みごたえ"],
      flavors: ["かわいいデザイン", "アイシングの甘さ", "ココアの香り", "バターの香り"],
      fortune: "いたずら心が幸運を呼ぶ日。ちょっとしたサプライズで誰かを笑顔に。",
    },
    {
      id: "jack", name: "ハロウィン限定ケーキ", chara: "ジャック・オ・ランタン伯爵", emoji: "🎃", color: "#e86a1c", rarity: "SR", seasons: ["halloween"],
      keyword: "トリック・オア・トリート",
      textures: ["スポンジがふわふわ", "クリームがなめらか", "しっとり", "ボリューム満点"],
      flavors: ["かぼちゃの甘み", "ハロウィンらしい見た目", "チョコのコク", "やさしい甘さ"],
      fortune: "お菓子をくれる人に、幸運がまわってくる日。分け合うほど運気アップ。",
    },
    {
      id: "xmas-cake", name: "クリスマスケーキ", chara: "サンタショート", emoji: "🎅", color: "#d9455f", rarity: "SR", seasons: ["christmas"],
      keyword: "ごちそう",
      textures: ["スポンジがふわふわ", "クリームが軽い", "しっとりスポンジ", "ボリューム満点"],
      flavors: ["いちごの甘酸っぱさ", "ミルキーなクリーム", "華やかな見た目", "やさしい甘さ"],
      fortune: "大切な人と過ごす時間に、ごほうびが届く日。素直な「ありがとう」を。",
    },
    {
      id: "xmas-cookie", name: "クリスマスクッキー", chara: "スノーマン", emoji: "⛄", color: "#7fb3d9", rarity: "R", seasons: ["christmas"],
      keyword: "きらきら",
      textures: ["さくさく", "ほろほろ", "アイシングがかりっ", "しっとりめ"],
      flavors: ["かわいいデザイン", "スパイスの香り", "アイシングの甘さ", "バターの香り"],
      fortune: "小さな贈りものが、大きな縁をつなぐ日。メッセージを添えて。",
    },
    {
      id: "chocolat", name: "バレンタインのショコラ", chara: "ショコラ執事", emoji: "🍫", color: "#5a3424", rarity: "SR", seasons: ["valentine"],
      keyword: "濃厚",
      textures: ["しっとり濃厚", "口どけがいい", "ねっとり", "ふわっと軽め"],
      flavors: ["カカオの香り", "チョコの濃さ", "ほろ苦さ", "華やかな見た目"],
      fortune: "気持ちを伝えると、思った以上に届く日。勇気をひとさじ。",
    },
    {
      id: "spring-cookie", name: "春のクッキー缶", chara: "さくらクッキーズ", emoji: "🌸", color: "#f2a7bd", rarity: "R", seasons: ["spring"],
      keyword: "春らしさ",
      textures: ["さくさく", "ほろほろ", "しっとりめ", "軽い口どけ"],
      flavors: ["春らしい見た目", "桜の香り", "いちごの甘酸っぱさ", "バターの香り"],
      fortune: "新しい出会いが花ひらく日。はじめましての人にこそ笑顔を。",
    },
    {
      id: "cherry", name: "さくらんぼのタルト・ケーキ", chara: "さくらんぼ姉妹", emoji: "🍒", color: "#d9455f", rarity: "SR", seasons: ["cherry"],
      keyword: "旬の味",
      textures: ["タルト生地がさくっ", "スポンジがふわふわ", "果物がみずみずしい", "食べごたえ十分"],
      flavors: ["さくらんぼの甘酸っぱさ", "旬の果物の香り", "クリームのコク", "華やかな見た目"],
      fortune: "めぐってきたチャンスは、旬のうちにつかんで。ふたりで分け合うとさらに吉。",
    },
  ],

  // 季節の期間（月-日）。この期間だけ、上の seasons が一致するキャラが登場します。
  // sparks はクッキーを割ったときに飛ぶ絵文字、theme はページの色と飾りです。
  seasons: [
    { id: "valentine", name: "バレンタイン", from: "02-01", to: "02-14", sparks: ["💝", "🍫", "✨"], banner: "🍫 バレンタイン限定キャラが出るかも！" },
    { id: "spring", name: "春", from: "03-01", to: "04-30", sparks: ["🌸", "🌷", "✨"], banner: "🌸 春の限定キャラが出るかも！" },
    { id: "cherry", name: "さくらんぼの季節", from: "06-01", to: "07-15", sparks: ["🍒", "✨"], banner: "🍒 さくらんぼの季節限定キャラが出るかも！" },
    { id: "autumn", name: "秋", from: "09-01", to: "11-30", sparks: ["🍂", "🌰", "✨"], banner: "🌰 秋の味覚キャラが出るかも！" },
    { id: "halloween", name: "ハロウィン", from: "10-01", to: "10-31", sparks: ["🎃", "🦇", "👻", "🍬"], banner: "🎃 ハロウィン限定キャラ出現中！", theme: "halloween" },
    { id: "christmas", name: "クリスマス", from: "12-01", to: "12-25", sparks: ["❄️", "⭐", "🎄"], banner: "🎄 クリスマス限定キャラが出るかも！", theme: "christmas" },
  ],
  // 季節限定キャラの出やすさ（同じレア度の定番キャラの何倍か）
  seasonalBoost: 2,

  // 「今日これを選んだ理由は？」の選択肢（このお店ならではの項目を入れています）
  reasons: ["見た目に惹かれて", "前に食べておいしかった", "口コミを見て", "季節限定だから", "自販機で見かけて", "お菓子教室で知って", "人に勧められて", "通りがかりに"],

  // 占いの運勢ランク
  luckRanks: ["大吉", "中吉", "小吉", "吉", "末吉"],
  luckyItems: ["紅茶", "ブラックコーヒー", "ハンカチ", "黄色い小物", "手書きのメモ", "花", "お気に入りのマグ", "散歩"],
};
