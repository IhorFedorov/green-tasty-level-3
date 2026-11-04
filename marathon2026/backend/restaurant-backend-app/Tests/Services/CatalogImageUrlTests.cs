using Amazon.Lambda.Core;
using Amazon.S3;
using APIHandler.Helpers;
using APIHandler.Mappers;
using APIHandler.Models.Dishes;
using APIHandler.Models.Locations;
using APIHandler.Services;
using Moq;

namespace APIHandler.Tests.Services;

[CollectionDefinition("Catalog images", DisableParallelization = true)]
public class CatalogImagesCollection { }

[Collection("Catalog images")]
public class CatalogImageUrlTests : IDisposable
{
    private const string Cdn = "https://d123example.cloudfront.net";
    private readonly Dictionary<string, string?> previous = new();
    public CatalogImageUrlTests()
    {
        foreach (var pair in new Dictionary<string, string> { ["imagesBucketName"] = "owned-images", ["REGION"] = "eu-north-1", ["IMAGES_CDN_BASE_URL"] = Cdn })
        {
            previous[pair.Key] = Environment.GetEnvironmentVariable(pair.Key);
            Environment.SetEnvironmentVariable(pair.Key, pair.Value);
        }
    }
    public void Dispose() { foreach (var pair in previous) Environment.SetEnvironmentVariable(pair.Key, pair.Value); }

    [Theory]
    [InlineData("https://owned-images.s3.eu-north-1.amazonaws.com/assets/img/dishes/dish.jpg")]
    [InlineData("http://owned-images.s3.amazonaws.com/assets/img/dishes/dish.jpg")]
    [InlineData("https://owned-images.s3-eu-north-1.amazonaws.com/assets/img/dishes/dish.jpg")]
    [InlineData("https://s3.amazonaws.com/owned-images/assets/img/dishes/dish.jpg")]
    [InlineData("https://s3.eu-north-1.amazonaws.com/owned-images/assets/img/dishes/dish.jpg?old=query")]
    public void ExistingOwnedS3Urls_MapWithoutDataMigration(string stored)
        => Assert.Equal(Cdn + "/assets/img/dishes/dish.jpg", CatalogImageUrl.Resolve(stored));

    [Theory]
    [InlineData("https://other-images.s3.eu-north-1.amazonaws.com/assets/img/dishes/dish.jpg")]
    [InlineData("https://owned-images.s3.eu-north-1.amazonaws.com.attacker.test/assets/img/dishes/dish.jpg")]
    [InlineData("https://owned-images.s3.eu-north-1.amazonaws.com/profiles/person.jpg?signature=unchanged")]
    [InlineData("https://example.com/dish.jpg")]
    [InlineData("assets/img/dishes/local.jpg")]
    [InlineData(Cdn + "/assets/img/dishes/dish.jpg")]
    public void UnrelatedProfileExternalRelativeAndCdnUrls_ArePreserved(string stored)
        => Assert.Equal(stored, CatalogImageUrl.Resolve(stored));

    [Fact]
    public void KeyEscapingAndLocationPrefix_ArePreserved()
        => Assert.Equal(Cdn + "/assets/img/locations/front%20door.jpg", CatalogImageUrl.FromKey("assets/img/locations/front%20door.jpg"));

    [Theory]
    [InlineData("profiles/person.jpg")]
    [InlineData("assets/img/dishes/../profile.jpg")]
    [InlineData("assets/img/dishes/%2e%2e/profile.jpg")]
    [InlineData("assets/img/dishes/test?query")]
    public void NonCatalogAndTraversalKeys_AreRejected(string key)
        => Assert.Throws<ArgumentException>(() => CatalogImageUrl.FromKey(key));

    [Theory]
    [InlineData(null)] [InlineData("")] [InlineData("http://d123example.cloudfront.net")]
    [InlineData("https://example.com")] [InlineData("https://d123example.cloudfront.net/path")]
    [InlineData("https://d123example.cloudfront.net?token=test")]
    public void MissingOrInvalidCdn_FailsClosed(string configured)
    {
        Environment.SetEnvironmentVariable("IMAGES_CDN_BASE_URL", configured);
        Assert.Throws<InvalidOperationException>(() => CatalogImageUrl.FromKey("assets/img/dishes/dish.jpg"));
    }

    [Fact]
    public void AllCatalogDtoMappers_MapUrlsWithoutMutatingStoredEntities()
    {
        var stored = "https://owned-images.s3.eu-north-1.amazonaws.com/assets/img/dishes/dish.jpg";
        var dish = DishMapper.FromCreateRequest(new CreateDishRequest { Name = "Demo", Description = "Demo", Weight = "1", Calories = "1", Proteins = "1", Fats = "1", Carbohydrates = "1", Vitamins = "A", LocationIds = [] });
        dish.ImageUrl = stored;
        Assert.Equal(Cdn + "/assets/img/dishes/dish.jpg", DishMapper.ToDishResponse(dish).ImageUrl);
        Assert.Equal(Cdn + "/assets/img/dishes/dish.jpg", DishMapper.ToDishListResponse(dish).ImageUrl);
        Assert.Equal(Cdn + "/assets/img/dishes/dish.jpg", GuestMenuDishMapper.Map(dish).ImageUrl);
        Assert.Equal(stored, dish.ImageUrl);
        var location = LocationMapper.FromCreateRequest(new CreateLocationRequest { Address = "Demo", Description = "Demo", AverageOccupancy = "50" });
        location.ImageUrl = stored.Replace("dishes", "locations");
        Assert.Equal(Cdn + "/assets/img/locations/dish.jpg", LocationMapper.ToLocationResponse(location).ImageUrl);
        Assert.Equal(stored.Replace("dishes", "locations"), location.ImageUrl);
    }

    [Fact]
    public void NewPublicCatalogUrl_UsesCdnWithoutS3Calls()
    {
        var storage = new Mock<IAmazonS3>(MockBehavior.Strict);
        var service = new S3ImageService(storage.Object);
        Assert.Equal(Cdn + "/assets/img/dishes/dish.jpg", service.GetPublicUrl("owned-images", "assets/img/dishes/dish.jpg"));
        storage.VerifyNoOtherCalls();
    }

    [Fact]
    public async Task InvalidCdn_StopsUploadBeforeImageDecodingOrPutObject()
    {
        Environment.SetEnvironmentVariable("IMAGES_CDN_BASE_URL", null);
        var storage = new Mock<IAmazonS3>(MockBehavior.Strict);
        await Assert.ThrowsAsync<InvalidOperationException>(() => new S3ImageService(storage.Object).UploadImageAsync([], "owned-images", "dish.png", Mock.Of<ILambdaLogger>(), "assets/img/dishes"));
        storage.VerifyNoOtherCalls();
    }
}
