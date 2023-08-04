const axios = require("axios");
const youtubeEndpoint = `https://www.youtube.com`;

const GetYoutubeInitData = async (url) => {
    try {
        const res = await axios.get(encodeURI(url));
        const ytInitData = res.data.split("var ytInitialData =");
        if (ytInitData && ytInitData.length > 1) {
            const data = ytInitData[1].split("</script>")[0].slice(0, -1);
            let apiToken = null;
            if (res.data.split("innertubeApiKey").length > 0) {
                apiToken = res.data
                    .split("innertubeApiKey")[1]
                    .trim()
                    .split(",")[0]
                    .split('"')[2];
            };

            let context = null;
            if (res.data.split("INNERTUBE_CONTEXT").length > 0) {
                context = JSON.parse(
                    res.data.split("INNERTUBE_CONTEXT")[1].trim().slice(2, -2)
                );
            };

            const initdata = JSON.parse(data);
            return await Promise.resolve({ initdata, apiToken, context });
        } else {
            return await Promise.reject("cannot_get_init_data");
        }
    } catch (err) {
        return await Promise.reject(err);
    };
};

const GetData = async (
    keyword,
    withPlaylist = false,
    limit = 0,
    options = []
) => {
    try {
        let endpoint = `${youtubeEndpoint}/results?search_query=${keyword}`;

        if (Array.isArray(options) && options.length > 0) {
            const type = options.find((z) => z.type);
            if (typeof type === "object") {
                if (typeof type.type === "string") {
                    switch (type.type.toLowerCase()) {
                        case "video": endpoint = `${endpoint}&sp=EgIQAQ%3D%3D`; break;
                        case "channel": endpoint = `${endpoint}&sp=EgIQAg%3D%3D`; break;
                        case "playlist": endpoint = `${endpoint}&sp=EgIQAw%3D%3D`; break;
                        case "movie": endpoint = `${endpoint}&sp=EgIQBA%3D%3D`; break;
                    };
                };
            };
        };

        const initData = await GetYoutubeInitData(endpoint);
        const sectionListRenderer = initData.initdata.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer;
        let contToken = {};
        let items = [];

        sectionListRenderer.contents.forEach((content) => {
            if (content.continuationItemRenderer) {
                contToken = content.continuationItemRenderer.continuationEndpoint.continuationCommand.token;
            } else if (content.itemSectionRenderer) {
                content.itemSectionRenderer.contents.forEach((item) => {
                    if (item.channelRenderer) {
                        let channelRenderer = item.channelRenderer;
                        items.push({
                            id: channelRenderer.channelId,
                            type: "channel",
                            thumbnail: channelRenderer.thumbnail,
                            title: channelRenderer.title.simpleText,
                        });
                    } else {
                        let videoRender = item.videoRenderer;
                        let playListRender = item.playlistRenderer;
                        if (videoRender && videoRender.videoId) {
                            items.push(VideoRender(item));
                        }
                        if (withPlaylist) {
                            if (playListRender && playListRender.playlistId) {
                                items.push({
                                    id: playListRender.playlistId,
                                    type: "playlist",
                                    thumbnail: playListRender.thumbnails,
                                    title: playListRender.title.simpleText,
                                    length: playListRender.videoCount,
                                    videos: playListRender.videos,
                                    videoCount: playListRender.videoCount,
                                    isLive: false,
                                });
                            };
                        };
                    };
                });
            };
        });
        const apiToken = initData.apiToken;
        const context = initData.context;
        const nextPageContext = { context: context, continuation: contToken };
        const itemsResult = limit != 0 ? items.slice(0, limit) : items;
        return await Promise.resolve({
            items: itemsResult,
            nextPage: { nextPageToken: apiToken, nextPageContext: nextPageContext }
        });
    } catch (err) {
        return await Promise.reject(err);
    };
};

const nextPage = async (nextPage, withPlaylist = false, limit = 0) => {
    const endpoint = `${youtubeEndpoint}/youtubei/v1/search?key=${nextPage.nextPageToken}`;
    try {
        const res = await axios.post(
            encodeURI(endpoint),
            nextPage.nextPageContext
        );
        const item1 = res.data.onResponseReceivedCommands[0].appendContinuationItemsAction;
        let items = [];
        item1.continuationItems.forEach((conitem) => {
            if (conitem.itemSectionRenderer) {
                conitem.itemSectionRenderer.contents.forEach((item, index) => {
                    let videoRender = item.videoRenderer;
                    let playListRender = item.playlistRenderer;
                    if (videoRender && videoRender.videoId) {
                        items.push(VideoRender(item));
                    }
                    if (withPlaylist) {
                        if (playListRender && playListRender.playlistId) {
                            items.push({
                                id: playListRender.playlistId,
                                type: "playlist",
                                thumbnail: playListRender.thumbnails,
                                title: playListRender.title.simpleText,
                                length: playListRender.videoCount,
                                videos: GetPlaylistData(playListRender.playlistId),
                            });
                        };
                    };
                });
            } else if (conitem.continuationItemRenderer) {
                nextPage.nextPageContext.continuation = conitem.continuationItemRenderer.continuationEndpoint.continuationCommand.token;
            };
        });
        const itemsResult = limit != 0 ? items.slice(0, limit) : items;
        return await Promise.resolve({ items: itemsResult, nextPage: nextPage });
    } catch (err) {
        return await Promise.reject(err);
    };
};

const GetPlaylistData = async (playlistId, limit = 0) => {
    const endpoint = `${youtubeEndpoint}/playlist?list=${playlistId}`;
    try {
        const initData = GetYoutubeInitData(endpoint);
        const sectionListRenderer = initData.initdata;
        const metadata = sectionListRenderer.metadata;
        if (sectionListRenderer && sectionListRenderer.contents) {
            const videoItems = sectionListRenderer.contents
                .twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content
                .sectionListRenderer.contents[0].itemSectionRenderer.contents[0]
                .playlistVideoListRenderer.contents;
            let items = [];
            videoItems.forEach((item) => {
                let videoRender = item.playlistVideoRenderer;
                if (videoRender && videoRender.videoId) {
                    items.push(VideoRender(item));
                };
            });
            const itemsResult = limit != 0 ? items.slice(0, limit) : items;
            return await Promise.resolve({ items: itemsResult, metadata: metadata });
        } else {
            return await Promise.reject("invalid_playlist");
        };
    } catch (err) {
        return await Promise.reject(err);
    };
};

const GetSuggestData = async (limit = 0) => {
    const endpoint = youtubeEndpoint;
    try {
        const initData = await GetYoutubeInitData(endpoint);
        const sectionListRenderer = initData.initdata.contents
            .twoColumnBrowseResultsRenderer.tabs[0].tabRenderer.content
            .richGridRenderer.contents;
        let items = [];
        let otherItems = [];
        sectionListRenderer.forEach((item) => {
            if (item.richItemRenderer && item.richItemRenderer.content) {
                let videoRender = item.richItemRenderer.content.videoRenderer;
                if (videoRender && videoRender.videoId) {
                    items.push(VideoRender(item.richItemRenderer.content));
                } else {
                    otherItems.push(videoRender);
                };
            };
        });
        const itemsResult = limit != 0 ? items.slice(0, limit) : items;
        return await Promise.resolve({ items: itemsResult });
    } catch (err) {
        return await Promise.reject(err);
    };
};

const GetChannelById = async (channelId) => {
    const endpoint = `${youtubeEndpoint}/channel/${channelId}`;
    try {
        const initData = await GetYoutubeInitData(endpoint);
        const tabs = initData.initdata.contents.twoColumnBrowseResultsRenderer.tabs;
        const items = tabs
            .map((json) => {
                if (json && json.tabRenderer) {
                    const tabRenderer = json.tabRenderer;
                    const title = tabRenderer.title;
                    const content = tabRenderer.content;
                    return { title, content };
                };
            })
            .filter((y) => typeof y != "undefined");
        return await Promise.resolve(items);
    } catch (err) {
        return await Promise.reject(err);
    };
};

const GetVideoDetails = async (videoId, fetchVideoThumbnail = true) => {
    const endpoint = `${youtubeEndpoint}/watch?v=${videoId}`;
    try {
        const initData = await GetYoutubeInitData(endpoint);
        const result = initData.initdata.contents.twoColumnWatchNextResults;
        const firstContent = result.results.results.contents[0].videoPrimaryInfoRenderer;
        const secondContent = result.results.results.contents[1].videoSecondaryInfoRenderer;

        let videoThumbnail = null;
        if(fetchVideoThumbnail) {
            const qualitys = [
                "maxresdefault",
                "sddefault",
                "hqdefault",
                "mqdefault",
                "default"
            ];

            for await (const quality of qualitys) {
                const url = `https://img.youtube.com/vi/${videoId}/${quality}.jpg`;
                const { status } = await axios(url, { validateStatus: false });
                if(status === 200) {
                    videoThumbnail = { quality, url };
                    break;
                };
            };
        };

        const res = {
            title: firstContent.title.runs[0].text,
            isLive: firstContent.viewCount.videoViewCountRenderer.hasOwnProperty("isLive")
            ? firstContent.viewCount.videoViewCountRenderer.isLive
            : false,
            author: {
                name: secondContent.owner.videoOwnerRenderer.title.runs[0].text,
                badges: secondContent.owner.videoOwnerRenderer.badges?.map((x) => x.metadataBadgeRenderer.icon.iconType) || [],
                thumbnails: secondContent.owner.videoOwnerRenderer.thumbnail.thumbnails
            },
            thumbnail: videoThumbnail,
            description: secondContent.attributedDescription.content,
            suggestions: result.secondaryResults.secondaryResults.results
            .filter((y) => y.hasOwnProperty("compactVideoRenderer"))
            .map((x) => compactVideoRenderer(x))
        };

        return await Promise.resolve(res);
    } catch (err) {
        return await Promise.reject(err);
    };
};

const VideoRender = (json) => {
    try {
        if (json && (json.videoRenderer || json.playlistVideoRenderer)) {
            let videoRenderer = {};
            if (json.videoRenderer) {
                videoRenderer = json.videoRenderer;
            } else if (json.playlistVideoRenderer) {
                videoRenderer = json.playlistVideoRenderer;
            };
            let isLive = false;
            if (videoRenderer?.badges?.[0]?.metadataBadgeRenderer?.style === "BADGE_STYLE_TYPE_LIVE_NOW") isLive = true;
            if (videoRenderer.thumbnailOverlays) {
                videoRenderer.thumbnailOverlays.forEach((item) => {
                    if (item?.thumbnailOverlayTimeStatusRenderer?.style === "LIVE") {
                        isLive = true;
                    };
                });
            };
            const lengthText = videoRenderer?.lengthText?.simpleText;
            let length = {};
            if (lengthText) {
                const lengthTextSplited = lengthText.split(":").map((n) => Number(n));
                let lengthSeconds = 0;
                if (lengthTextSplited.length === 1) {
                    lengthSeconds = lengthTextSplited[0];
                } else if (lengthTextSplited.length === 2) {
                    const min = lengthTextSplited[0];
                    const s = lengthTextSplited[1];
                    lengthSeconds = (min * 60) + s;
                } else if (lengthTextSplited.length === 3) {
                    const h = lengthTextSplited[0];
                    const min = lengthTextSplited[1];
                    const s = lengthTextSplited[2];
                    lengthSeconds = (h * 3600) + (min * 60) + s;
                };
                length = {
                    seconds: lengthSeconds,
                    text: lengthText
                };
            };
            const { channelThumbnailWithLinkRenderer } = videoRenderer.channelThumbnailSupportedRenderers;
            return {
                id: videoRenderer.videoId,
                type: "video",
                thumbnails: videoRenderer.thumbnail.thumbnails,
                title: videoRenderer.title.runs[0].text,
                channel: {
                    id: channelThumbnailWithLinkRenderer.navigationEndpoint.browseEndpoint.browseId,
                    name: videoRenderer.ownerText.runs[0].text,
                    thumbnails: channelThumbnailWithLinkRenderer.thumbnail.thumbnails
                },
                length,
                isLive,
            };
        } else {
            return {};
        }
    } catch (err) {
        throw err;
    };
};

const compactVideoRenderer = (json) => {
    const compactVideoRendererJson = json.compactVideoRenderer;

    let isLive = false;
    if (
        compactVideoRendererJson.badges &&
        compactVideoRendererJson.badges.length > 0 &&
        compactVideoRendererJson.badges[0].metadataBadgeRenderer &&
        compactVideoRendererJson.badges[0].metadataBadgeRenderer.style === "BADGE_STYLE_TYPE_LIVE_NOW"
    ) {
        isLive = true;
    };

    const result = {
        id: compactVideoRendererJson.videoId,
        type: "video",
        thumbnail: compactVideoRendererJson.thumbnail.thumbnails,
        title: compactVideoRendererJson.title.simpleText,
        channelTitle: compactVideoRendererJson.shortBylineText.runs[0].text,
        shortBylineText: compactVideoRendererJson.shortBylineText.runs[0].text,
        length: compactVideoRendererJson.lengthText,
        isLive,
    };

    return result;
};

module.exports = {
    GetListByKeyword: GetData,
    NextPage: nextPage,
    GetPlaylistData: GetPlaylistData,
    GetSuggestData: GetSuggestData,
    GetChannelById: GetChannelById,
    GetVideoDetails: GetVideoDetails
};
