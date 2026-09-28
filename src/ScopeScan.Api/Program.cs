using ScopeScan.Core;

var builder = WebApplication.CreateBuilder(args);

var dataRoot = builder.Configuration["ScopeScan:DataRoot"] ?? Path.Combine(builder.Environment.ContentRootPath, "data");
builder.Services.AddScopeScanCore(dataRoot);

var app = builder.Build();

// Scan/scope/report endpoints are added in Phase 6.
app.MapGet("/health", () => Results.Ok(new { status = "ok" }));

app.Run();

public partial class Program;
